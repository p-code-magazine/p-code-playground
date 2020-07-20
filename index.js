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

server.listen(port, () => {
  console.log('Server listening at port %d', port);
});

// Static
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ...
const loggerAction = (tgl) => {
  let ret = {
    state: 'error'
  };

  toggle = parseInt(tgl);

  if (currentPlayer) {
    return {
      state: 'error:RUNNING_PLAYBACK'
    };
  }

  if (toggle == 0 && currentLogger) {
    currentLogger.end();
    container.close(`session-${loggerStartAt}`);
    currentLogger = false;

    ret = {
      state: 'finished',
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
      console.log('currentLogger done');
    });

    ret = {
      state: 'started',
      file: `session-${loggerStartAt}.log`
    };
  }

  return ret;
};

const playbackAction = async (cue, file = null) => {
  let ret = {
    state: 'error:INVALID_OPERATION'
  };

  if (currentLogger) {
    return {
      state: 'error:RUNNING_LOGGER'
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
            case 'join':
              io.sockets.emit('user joined', {
                username: `[${file}]${el.user}`,
                numUsers: -1
              });
              break;
            case 'message':
              io.sockets.emit('new message', {
                username: `[${file}]${el.user}`,
                message: el.message,
                numUsers: -1,
                autoJoin: true
              });
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
        state: 'playing',
        file
      };
    } else {
      if (currentPlayer) {
        currentPlayer.terminate();
        currentPlayer = false;

        ret = {
          state: 'stop',
          file
        };
      } else {
        ret = {
          state: 'error:NOT_PLAYING'
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

// Chatroom

var numUsers = 0;

io.on('connection', (socket) => {
  var addedUser = false;

  // when the client emits 'new message', this listens and executes
  socket.on('new message', (data) => {
    // we tell the client to execute 'new message'
    if (/^#! [a-z\-]+ [a-z0-9\.\-\,]+/.test(data)) {
      const cmds = data.match(/^#! ([a-z\-]+) ([a-z0-9\.\-\,]+)/);
      let ret = false;

      if (cmds.length > 2) {
        switch(cmds[1]) {
        case 'logging':
          ret = loggerAction(cmds[2]);
          break;
        case 'logging-playback':
          const cpair = cmds[2].split(',');
          (async () => {
            ret = await playbackAction(cpair[0], cpair[1]);
          })();
          break;
        }
      }
      socket.broadcast.emit('new message', {
        username: socket.username,
        message: `${data} - ${JSON.stringify(ret)}`
      });
    } else {
      socket.broadcast.emit('new message', {
        username: socket.username,
        message: data
      });
    }

    if (currentLogger.writable) {
      currentLogger.info(`${data}`, {
        user: socket.username,
        delta: Date.now() - loggerStartAt,
        action: 'message'
      });
    }
  });

  // when the client emits 'add user', this listens and executes
  socket.on('add user', (username) => {
    if (addedUser) return;

    // we store the username in the socket session for this client
    socket.username = username;
    ++numUsers;
    addedUser = true;
    socket.emit('login', {
      numUsers: numUsers
    });
    // echo globally (all clients) that a person has connected
    socket.broadcast.emit('user joined', {
      username: socket.username,
      numUsers: numUsers
    });

    if (currentLogger.writable) {
      currentLogger.info(numUsers, {
        user: socket.username,
        delta: Date.now() - loggerStartAt,
        action: 'join'
      });
    }
  });

  // when the client emits 'typing', we broadcast it to others
  socket.on('typing', () => {
    socket.broadcast.emit('typing', {
      username: socket.username
    });
    console.log('typing..', socket.username);
  });

  // when the client emits 'stop typing', we broadcast it to others
  socket.on('stop typing', () => {
    socket.broadcast.emit('stop typing', {
      username: socket.username
    });
  });

  // when the user disconnects.. perform this
  socket.on('disconnect', () => {
    if (addedUser) {
      --numUsers;

      // echo globally that this client has left
      socket.broadcast.emit('user left', {
        username: socket.username,
        numUsers: numUsers
      });
    }

    if (currentLogger.writable) {
      currentLogger.info(numUsers, {
        user: socket.username,
        delta: Date.now() - loggerStartAt,
        action: 'diconnect'
      });
    }

    if (numUsers == 0 && currentLogger) {
      currentLogger.end();
      container.close(`session-${loggerStartAt}`);
      currentLogger = false;
    }
  });
});
