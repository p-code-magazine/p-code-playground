// Setup basic express server
const express = require('express');
const app = express();
const cors = require('cors');
const path = require('path');
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: (
      process.env.NODE_ENV == 'development' ? [
        'http://localhost:8080', 'http://localhost:3000'
      ] : [
        'https://r3pl-git-develop.inafact.vercel.app',
        'https://r3pl.vercel.app',
        'https://play.p-code-magazine.haus',
      ]
    ),
    methods: ['GET', 'POST'],
    credentials: true,
  },
});
const port = process.env.PORT || 8080;

const { readFile, readdir } = require('fs').promises;
const { Worker } = require('worker_threads');

const winston = require('winston');
const { format } = winston;
const { combine, timestamp, json } = format;

const container = new winston.Container();
const logsPath = path.resolve(__dirname, 'logs');

let loggerStartAt = Date.now();
let currentLogger = false;
let currentPlayer = false;

console.log(process.env.NODE_ENV);

server.listen(port, () => {
  console.log('Server listening at port %d', port);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors({
  origin: (
    process.env.NODE_ENV == 'development' ? '*' : [
      'https://r3pl-git-develop.inafact.vercel.app',
      'https://r3pl.vercel.app',
      'https://play.p-code-magazine.haus',
    ]
  ),
  credentials: true,
  // optionsSuccessStatus: 200
}));

// ...
const metaAction = async (msg_or_msgs) => {
  const msg = (msg_or_msgs instanceof Array) ? msg_or_msgs[0] : msg_or_msgs;

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

        switch (cmdBase[1]) {
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
    const fd = await readdir(logsPath).catch(console.error);
    const r = new RegExp(`^.+\.${ext}$`);
    ret = {
      status: 'success',
      data: fd.filter((el) => r.test(el))
    };
  } catch (err) {
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

        resolve(Object.assign(ret, { status: 'success', data: results }));
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
        const fp = await readFile(path.join(logsPath, file)).catch(console.error);
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
        // TODO: r3pl format
        if (msg.key == 'main') {
          if (next[0] != undefined && msg.val >= parseInt(next[0].delta)) {
            switch (next[0].action) {
              case 'message':
                io.emit('new message', {
                  username: `[${file ? file : 'current session'}] ${next[0].username}`,
                  message: next[0].message,
                  timestamp: next[0].timestamp,
                  bus: next[0].bus,
                  numUsers: io.sockets.sockets.size
                });
                break;
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
        // --
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
  } catch (err) {
    console.error(err);
  }

  return ret;
};

app.get('/download/:file', async (req, res, next) => {
  const { file = '' } = req.params;
  const fp = await readFile(path.join(logsPath, file)).catch((err) => err);
  const { code = false } = fp;

  if (code) {
    res.json({ message: `error:${code}` });
  } else {
    res.type('text/plain');
    res.attachment();
    res.send(fp.toString());
  }
});

app.post('/join', async (req, res, next) => {
  const { username = '' } = req.body;
  res.json({ status: (username ? true : false) });
});

io.on('connection', (socket) => {
  let addedUser = false;

  // console.log(io.sockets.sockets);
  console.log('clients:', io.sockets.sockets.size);

  socket.on('add user', (username) => {
    if (addedUser) return;

    socket.username = username;
    addedUser = true;

    socket.emit('login', {
      numUsers: io.sockets.sockets.size
    });

    socket.broadcast.emit('user joined', {
      username: socket.username,
      numUsers: io.sockets.sockets.size
    });

    recordLogAction(1);
  });

  socket.on('new message', async (data) => {
    //! w/ backword compatiblity
    const { message, ...options } = (typeof data == 'string') ? { message: data } : data;
    const ret = await metaAction(message).catch(console.error);
    const cnow = Date.now();

    const msg = (message instanceof Array) ? message.shift() : message;

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
            message: `${msg} - ${JSON.stringify(ret)}`,
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
        message: `${msg} - ${JSON.stringify(ret)}`,
        color: '#999',
        bus: '*'
      });
    } else {
      //! PCode
      const { bus = 0 } = options;
      io.emit(
        'new message',
        ((message instanceof Array) && (message.length > 0)) ? {
          username: socket.username,
          message: `${msg}`,
          bus,
          timestamp: new Date(cnow),
          r: `${message[0]}`
        } : {
          username: socket.username,
          message: msg,
          bus,
          timestamp: new Date(cnow)
        }
      );
    }

    if (currentLogger.writable && !ret) {
      const { bus = 0 } = options;
      const meta = {
        username: socket.username,
        bus: parseInt(bus),
        //! timestamp is added automaticaly by winston
        // timestamp: new Date(cnow),
        delta: cnow - loggerStartAt,
        action: 'message'
      };

      if ((message instanceof Array) && message.length > 0) {
        meta.r = `${message[0]}`;
      }

      currentLogger.info(`${msg}`, meta);
    }
  });

  socket.on('typing', () => {
    socket.broadcast.emit('typing', {
      username: socket.username,
      numUsers: io.sockets.sockets.size
    });
  });

  socket.on('disconnect', () => {
    console.log('active clients:', io.sockets.sockets.size);

    if (addedUser) {
      socket.broadcast.emit('user left', {
        username: socket.username,
        numUsers: io.sockets.sockets.size
      });
    }

    if (io.sockets.sockets.size == 0 && currentLogger) {
      currentLogger.end();
      container.close(`session-${loggerStartAt}`);
      currentLogger = false;
    }
  });
});
