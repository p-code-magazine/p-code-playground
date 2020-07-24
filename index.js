// Setup basic express server
const express = require('express');
const app = express();
const path = require('path');
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const port = process.env.PORT || 3000;

const { readFile, readdir } = require('fs').promises;
const { Worker } = require('worker_threads');

const winston = require('winston');
const { format } = winston;
const { combine, timestamp, label, json } = format;

const container = new winston.Container();
const logsPath = path.resolve(__dirname, 'logs');

let loggerStartAt = Date.now();
let currentLogger = false;
let currentPlayer = false;
let numUsers = 0;

server.listen(port, () => {
  console.log('Server listening at port %d', port);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ...
const metaAction = async (msg) => {
  if (msg.indexOf('$$') == 0) {
    let ret = {
      status: 'error:SERVER_META_ACTION_NOT_FOUND'
    };

    if (/^\$\$ [a-zA-Z\-]+ [a-zA-Z0-9\.\-\,]+/.test(msg)) {
      const cmds = msg.match(/^\$\$ ([a-zA-Z\-]+) ([a-zA-Z0-9\.\-\,\:]+)/);

      console.log('tested meta action', cmds);

      if (cmds.length > 2) {
        let args, args_raw;

        switch(cmds[1]) {
        case 'S':
          ret = await showLogsAction(cmds[2]);
          break;
        case 'L':
          ret = startLoggerAction(cmds[2]);
          break;
        case 'P':
          args = cmds[2].split(',');
          ret = await playbackAction(args[0], args[1]);
          break;
        case 'H':
          args_raw = cmds[2].split(',');
          const [a1 = '', a2 = 1] = args_raw;
          const dt = new Date(a1);
          args = {
            until: (dt.toString() === 'Invalid Date') ? Date.now() : (dt - 1),
            limit: a2
          };
          ret = await queryAction(args);
          break;
        }

        ret['action'] = cmds[1];
      }
    }

    return ret;
  } else {
    return false;
  }
};


const showLogsAction = async (ext = '.log') => {
  let ret = {
    status: 'error:INVALID_OPERATION'
  };

  try {
    const fd = await readdir(`./logs`).catch(console.error);
    const r = new RegExp(`^.+\.${ext}$`);
    ret = {
      status: 'founded',
      data: fd.filter((el) => r.test(el))
    };
  } catch(err) {
    console.error(err);
  }

  return ret;
};

const queryAction = async (q) => {
  let ret = {
    status: 'error:UNKNOWN'
  };

  // TODO:
  if (currentLogger.writable) {
    const { until = Date.now(), limit = 1 } = q;
    const qoptions = {
      from: new Date(loggerStartAt),
      until: new Date(until),
      limit
    };

    ret = await new Promise((resolve, reject) => {
      currentLogger.query(qoptions, (err, results) => {
        if (err) {
          reject(Object.assign(ret, { data: err }));
        }

        resolve(Object.assign(ret, { status: 'founded',  data: results }));
      });
    });
  }

  return ret;
};

const startLoggerAction = (tgl) => {
  let ret = {
    status: 'error:UNKNOWN'
  };

  toggle = parseInt(tgl);

  if (currentPlayer) {
    return {
      status: 'error:RUNNUG_PLAYBACK'
    };
  }

  if (toggle == 0 && currentLogger) {
    currentLogger.end();
    container.close(`session-${loggerStartAt}`);
    currentLogger = false;

    ret = {
      status: 'finished',
      file: `session-${loggerStartAt}.log`
    };
  } else if (toggle > 0 && !currentLogger) {
    loggerStartAt = Date.now();
    container.add(`session-${loggerStartAt}`, {
      format: combine(
        // timestamp({ format: 'YYYY-MM-DD hh:mm:ss.SSS' }),
        timestamp(),
        json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: path.join(logsPath, `session-${loggerStartAt}.log`) })
      ]
    });
    currentLogger = container.get(`session-${loggerStartAt}`);
    currentLogger.on('finish', () => {
      console.log('currentLogger finished');
    });

    console.log('currentLogger started');

    ret = {
      status: 'started',
      file: `session-${loggerStartAt}.log`
    };
  } else {
    ret = {
      status: 'error:LOGGER_ALREADY_STARTED',
      file: `session-${loggerStartAt}.log`
    };
  }

  return ret;
};

const playbackAction = async (cue, file = null) => {
  let ret = {
    status: 'error:INVALID_OPERATION'
  };
  const ci = parseInt(cue);

  try {
    if (ci == 1 && !currentPlayer) {
      const fp = await readFile(`./logs/${file}`).catch(console.error);

      let d = fp.toString().split('\n');
      d.pop();
      let darr = JSON.parse(`[${d.join(',')}]`);
      let rdarr = darr.reverse();
      let el = rdarr.pop();

      console.log(el, rdarr);

      currentPlayer = new Worker('./worker.js');
      currentPlayer.on('message', (msg) => {
        if (msg.key == 'main') {
          if (rdarr.length > 0 && msg.val >= parseInt(el.delta)) {
            switch (el.action) {
            case 'message':
              io.emit('new message', {
                username: `[${file}]${el.username}`,
                message: el.message,
                timestamp: el.timestamp,
                bus: el.bus,
                numUsers: Object.keys(io.sockets.connected).length
              });
              break;
            case 'join':
              break;
            case 'diconnect':
              break;
            }

            console.log(el, msg);
            el = rdarr.pop();
          }
          // TODO: auto stop
        }
      });
      ret = {
        status: 'playing',
        file
      };
    } else if (ci == 0 && currentPlayer) {
      currentPlayer.terminate();
      currentPlayer = false;
      ret = {
        status: 'stop',
        file
      };
    }
  } catch(err) {
    console.error(err);
  }

  return ret;
};

app.post('/join', async (req, res, next) => {
  const { username = '' } = req.body;
  res.json({ status: (username ? true : false) });
});

io.on('connection', (socket) => {
  let addedUser = false;

  console.log('clients:', Object.keys(io.sockets.connected).length);

  socket.on('add user', (username) => {
    if (addedUser) return;

    socket.username = username;
    addedUser = true;

    socket.emit('login', {
      numUsers: Object.keys(io.sockets.connected).length
    });

    socket.broadcast.emit('user joined', {
      username: socket.username,
      numUsers: Object.keys(io.sockets.connected).length
    });

    startLoggerAction(1);
  });

  socket.on('new message', async (data) => {
    //! w/ backword compatiblity
    const { message, ...options } = (typeof data == 'string') ? { message: data } : data;
    const ret = await metaAction(message).catch(console.error);
    const cnow = Date.now();

    if (ret && ret.status.indexOf('error') != 0) {
      //! server meta command
      switch (ret.action) {
      case 'H':
        const { data: logdata } = ret;
        const { file: entry = [] } = logdata;
        socket.emit('reply command', {
          action: ret.action,
          message: entry
        });
        break;
      case 'S':
        const { data: files } = ret;
        socket.emit('new message', {
          username: `[server]`,
          message: JSON.stringify(files),
          color: '#999',
          bus: '*'
        });
        break;
      default:
        io.emit('new message', {
          username: `(server)`,
          message: `${message} - ${JSON.stringify(ret)}`,
          color: '#999',
          bus: '*'
        });
        break;
      }
      //
    } else if (ret && ret.status.indexOf('error') == 0) {
      //! server meta command w/ error
      socket.emit('new message', {
        username: `[server]`,
        message: `${message} - ${JSON.stringify(ret)}`,
        color: '#999',
        bus: '*'
      });
    } else {
      //! PCode
      const { bus = 0 } = options;
      io.emit('new message', {
        username: socket.username,
        message,
        bus,
        timestamp: new Date(cnow)
      });
    }

    if (currentLogger.writable && !ret) {
      const { bus = 0 } = options;

      currentLogger.info(`${message}`, {
        username: socket.username,
        bus: parseInt(bus),
        //! timestamp is added automaticaly by winston
        // timestamp: new Date(cnow),
        delta: cnow - loggerStartAt,
        action: 'message'
      });
    }
  });

  socket.on('typing', () => {
    socket.broadcast.emit('typing', {
      username: socket.username,
      numUsers: Object.keys(io.sockets.connected).length
    });
  });

  // socket.on('stop typing', () => {
  //   socket.broadcast.emit('stop typing', {
  //     username: socket.username,
  //     numUsers: Object.keys(io.sockets.connected).length
  //   });
  // });

  socket.on('disconnect', () => {
    console.log('active clients:', Object.keys(io.sockets.connected).length);

    if (addedUser) {
      socket.broadcast.emit('user left', {
        username: socket.username,
        numUsers: Object.keys(io.sockets.connected).length
      });
    }

    if (Object.keys(io.sockets.connected).length == 0 && currentLogger) {
      currentLogger.end();
      container.close(`session-${loggerStartAt}`);
      currentLogger = false;
    }
  });
});
