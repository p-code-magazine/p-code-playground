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

    if (/^\$\$ [A-Z\-]+( [a-zA-Z0-9\.\-\,\:]+)*/.test(msg)) {
      const cmdBase = msg.match(/^\$\$ ([A-Z\-]+)( [a-zA-Z0-9\.\-\,\:]+)*/);

      if (cmdBase.length > 2) {
        let args_raw = (cmdBase[2] !== undefined) ? cmdBase[2].match(/^ ([a-zA-Z0-9\.\-\,\:]+)$/) : [];
        let args = args_raw.length > 1 ? args_raw[1] : '';
        let args_sep = (args.indexOf(',') == -1) ? [args, ''] : args.split(',');

        switch(cmdBase[1]) {
        case 'L':
          ret = await showLogsAction();
          break;
        case 'R':
          ret = recordLogAction(args);
          break;
        case 'P':
          ret = await playbackLogAction(args_sep[0], args_sep[1]);
          break;
        case 'H':
          const [a1 = '', a2 = 1] = args_sep;
          const dt = new Date(a1);
          ret = await queryLogAction({
            until: (dt.toString() === 'Invalid Date') ? Date.now() : (dt - 1),
            limit: a2
          });
          break;
        }

        ret['action'] = cmdBase[1];
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
      status: 'success',
      data: fd.filter((el) => r.test(el))
    };
  } catch(err) {
    console.error(err);
  }

  return ret;
};

const queryLogAction = async (q) => {
  let ret = {
    status: 'error:UNKNOWN'
  };

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

        resolve(Object.assign(ret, { status: 'success',  data: results }));
      });
    });
  }

  return ret;
};

const recordLogAction = (tgl) => {
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
      status: 'success:LOGGER_FINISHED',
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
      status: 'success:LOGGER_STARTED',
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

const playbackLogAction = async (cue, file = null) => {
  let ret = {
    status: 'error:INVALID_OPERATION'
  };
  const ci = parseInt(cue);

  try {
    if (ci == 1 && !currentPlayer) {
      let rdarr = [];

      if (file) {
        const fp = await readFile(`./logs/${file}`).catch(console.error);
        let d = fp.toString().split('\n');

        d.pop();
        rdarr = JSON.parse(`[${d.join(',')}]`);
        rdarr = rdarr.reverse();
      } else {
        const { status, data } = await queryLogAction({
          //! max 1000
          limit: 1000
        });

        if (status == 'success') {
          rdarr = data.file;
        }
      }

      let next = [];
      next.push(rdarr.pop());

      console.log(next, rdarr);

      currentPlayer = new Worker('./worker.js');
      currentPlayer.on('message', (msg) => {
        if (msg.key == 'main') {
          if (next[0] != undefined && msg.val >= parseInt(next[0].delta)) {
            switch (next[0].action) {
            case 'message':
              io.emit('new message', {
                username: `[${file ? file : 'current session'}] ${next[0].username}`,
                message: next[0].message,
                timestamp: next[0].timestamp,
                bus: next[0].bus,
                numUsers: Object.keys(io.sockets.connected).length
              });
              break;
            // case 'join':
            //   break;
            // case 'diconnect':
            //   break;
            }
            next.splice(0, 1, rdarr.pop());
          }

          if (next[0] == undefined && rdarr.length == 0 && currentPlayer) {
            currentPlayer.terminate();
            currentPlayer = false;
            io.emit('new message', {
              username: `(server)`,
              message: `- {"status":"success:PLAYBACK_FINISHED", "file":"${file}"}`,
              color: '#999',
              bus: '*'
            });
          }
        }
      });
      ret = {
        status: 'success:PLAYBACK_STARTED',
        file
      };
    } else if (ci == 0 && currentPlayer) {
      currentPlayer.terminate();
      currentPlayer = false;
      ret = {
        status: 'success:PLAYBACK_STOPPED',
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

    recordLogAction(1);
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
      case 'L':
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
