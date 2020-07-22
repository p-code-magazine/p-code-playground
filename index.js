// Setup basic express server
const express = require('express');
const app = express();
const path = require('path');
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const port = process.env.PORT || 3000;

const { readFile } = require('fs').promises;
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
      const cmds = msg.match(/^\$\$ ([a-zA-Z\-]+) ([a-zA-Z0-9\.\-\,]+)/);

      console.log('tested meta action', cmds);

      if (cmds.length > 2) {
        let args, args_raw;

        switch(cmds[1]) {
        case 'L':
          ret = loggerAction(cmds[2]);
          break;
        case 'P':
          args = cmds[2].split(',');
          ret = await playbackAction(args[0], args[1]);
          break;
        case 'H':
          args_raw = cmds[2].split(',');
          const [a1 = '', a2 = 1] = args_raw;
          args = {
            until: isNaN(a1) ? Date.now() : parseInt(a1),
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


const queryAction = async (q) => {
  let ret = {
    status: 'error:UNKNOWN'
  };

  // TODO:
  if (currentLogger.writable) {
    const { until = Date.now(), limit = 1 } = q;

    ret = await new Promise((resolve, reject) => {
      currentLogger.query({
        until, limit
      }, (err, results) => {
        if (err) {
          reject(Object.assign(ret, { data: err }));
        }

        resolve(Object.assign(ret, { status: 'founded',  data: results }));
      });
    });
  }

  return ret;
};

const loggerAction = (tgl) => {
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
        timestamp({ format: 'YYYY-MM-DD hh:mm:ss.SSS' }),
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

  if (currentLogger) {
    return {
      status: 'error:RUNNING_LOGGER'
    };
  }

  try {
    if (parseInt(cue) == 1) {
      const fp = await readFile(`./logs/${file}`).catch(console.error);

      let d = fp.toString().split('\n');
      d.pop();
      let darr = JSON.parse(`[${d.join(',')}]`);
      let rdarr = darr.reverse();
      let el = rdarr.pop();

      currentPlayer = new Worker('./worker.js');
      currentPlayer.on('message', (msg) => {
        if (msg.key == 'main') {
          if (rdarr.length > 0 && msg.val >= parseInt(el.delta)) {
            //
            switch (el.action) {
            case 'message':
              io.emit('new message', {
                username: `[${file}]${el.user}`,
                message: el.message,
                numUsers: Object.keys(io.sockets.connected).length,
                autoJoin: true
              });
              break;
            case 'join':
              // io.emit('user joined', {
              //   username: `[${file}]${el.user}`,
              //   numUsers: -1
              // });
              break;
            case 'diconnect':
              // TODO:
              break;
            }

            console.log(el, msg);
            el = rdarr.pop();
            //
          }
        }
      });
      ret = {
        status: 'playing',
        file
      };
    } else {
      if (currentPlayer) {
        currentPlayer.terminate();
        currentPlayer = false;

        ret = {
          status: 'stop',
          file
        };
      } else {
        ret = {
          status: 'error:NOT_PLAYING'
        };
      }
    }
  } catch(err) {
    console.error(err);
  }

  return ret;
};

app.get('/logging/:toggle', (req, res, next) => {
  const { toggle } = req.params;
  const ret = loggerAction(toggle);
  res.json(ret);
});

app.post('/logging/playback', async (req, res, next) => {
  const { cue, file } = req.body;
  const ret = await playbackAction(cue, file);
  res.json(ret);
});

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
    // ++numUsers;
    addedUser = true;

    socket.emit('login', {
      // numUsers: numUsers
      numUsers: Object.keys(io.sockets.connected).length
    });

    socket.broadcast.emit('user joined', {
      username: socket.username,
      // numUsers: numUsers
      numUsers: Object.keys(io.sockets.connected).length
    });

    loggerAction(1);
  });

  socket.on('new message', async (data) => {
    let ret = await metaAction(data).catch(console.error);

    console.log(ret);

    if (ret && ret.status.indexOf('error') != 0) {
      //
      switch (ret.action) {
      case 'H':
        socket.emit('reply command', {
          message: `${data} - ${JSON.stringify(ret)}`
        });
        break;
      default:
        // io.emit('new message', {
        //   username: socket.username,
        //   message: `${data} - ${JSON.stringify(ret)}`,
        //   timestamp: Date.now()
        // });
        break;
      }
      //
    } else if (ret && ret.status.indexOf('error') == 0) {
      socket.emit('new message', {
        username: socket.username,
        message: `${data} - ${JSON.stringify(ret)}`
      });
    } else {
      io.emit('new message', {
        username: socket.username,
        message: data,
        timestamp: Date.now()
      });
    }

    if (currentLogger.writable && !ret) {
      currentLogger.info(`${data}`, {
        user: socket.username,
        delta: Date.now() - loggerStartAt,
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

  socket.on('stop typing', () => {
    socket.broadcast.emit('stop typing', {
      username: socket.username,
      numUsers: Object.keys(io.sockets.connected).length
    });
  });

  socket.on('disconnect', () => {
    console.log('clients:', Object.keys(io.sockets.connected).length);

    if (addedUser) {
      // --numUsers;

      socket.broadcast.emit('user left', {
        username: socket.username,
        // numUsers: numUsers
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
