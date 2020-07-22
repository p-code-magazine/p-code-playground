import { PCode } from '@h4us/p-code';
import io from 'socket.io-client';
import p5 from 'p5';
import 'alpinejs';

const COLORS = [
  '#e21400', '#91580f', '#f8a700', '#f78b00',
  '#58dc00', '#287b00', '#a8f07a', '#4ae8c4',
  '#3b88eb', '#3824aa', '#a700ff', '#d300e7'
];

window.appComponents = {
  // TODO:
  // sharedStore: new Proxy({
  //   helpActive: false
  // }, {
  //   set(t, prop, v) {
  //     return true;
  //   }
  // }),

  //
  cmdr() {
    return {
      currentInput: '',
      inputHistory: [],
      serverHistory: [],
      localHistoryIndex: 0,
      serverHistoryIndex: 0,
      typingUsers: [],
      tabText: 'server',
      numUsers: 0,
      //
      showHelp: false,
      showHistory: false,
      isLogin: false,
      //
      pcodes: [],
      p5s: [],
      userName: '',
      sio: null,

      init() {
        // TODO:
        setInterval(() => {
          if (this.typingUsers.length > 0) {
            this.typingUsers.splice(0, 1);
          } else {
            this.tabText = `server: online[${this.numUsers}]`;
          }
        }, 1500);
      },

      initSocket() {
        this.sio = io();

        this.sio.on('login', (data) => {
          console.log('login:', data);
          this.numUsers = data.numUsers;
          this.tabText = `server: online[${data.numUsers}]`;
        });

        this.sio.on('new message', (data) => {
          if (this.isLogin) {
            this.pushMessage('server', data);
          }
        });

        this.sio.on('reply command', (data) => {
          // TODO:
          console.log(data);
        });

        this.sio.on('user joined', (data) => {
          console.log('@alipine joined:', data);
          this.numUsers = data.numUsers;
          this.tabText = `server: online[${data.numUsers}]`;
        });

        this.sio.on('user left', (data) => {
          console.log('@alipine left:', data);
          this.numUsers = data.numUsers;
          this.tabText = `server: online[${data.numUsers}]`;
        });

        this.sio.on('typing', (data) => {
          console.log('@alipine typing:', data);
          if (this.typingUsers.findIndex((el) => el == data.username) < 0) {
            this.typingUsers.push(data.username);
          }

          this.tabText = `server: online[${data.numUsers}] | ${this.typingUsers.join(',')} typing..`;
        });

        this.sio.on('stop typing', (data) => {
          console.log('@alipine stop typing:', data);
        });

        this.sio.on('disconnect', () => {
          console.info('you have been disconnected');
        });

        this.sio.on('reconnect', () => {
          console.info('you have been reconnected');
          if (this.userName.length > 0) {
            this.sio.emit('add user', this.userName);
          }
        });
      },

      runPCode(code) {
        // TODO:
        let p;

        if (this.pcodes.length < 4) {
          p = new PCode({
            defaultVolume: -10,
            comment: { enable: true },
            meta: { enable: true }
          });
          this.pcodes.push(p);

          let _pcodes = this.pcodes;
          let s = (p) => {
            p.setup = () => {
              p.frameRate(30);
            };

            p.draw = () => {
              for(let el of _pcodes) {
                if(el.isPlaying) {
                  if(el.hasNext()) {
                    let node = el.tokens[el.pointer];
                    el.execute(node);
                    el.next();
                  } else {
                    el.isPlaying = false;
                  }
                } else {
                  if(el.doLoop) {
                    el.reset();
                    el.isPlaying = true;
                  } else {
                    el.stop();
                  }
                }
              }
            };
          };

          this.p5s.push(new p5(s));
        } else {
          //
          let ci = 0;
          p = this.pcodes[0];

          for (let i in this.pcodes) {
            if (i > 0) {
              if (p.lastEvaluateTime > this.pcodes[i].lastEvaluateTime) {
                p = this.pcodes[i];
                ci = i;
              }
            }
          }

          console.log(`run on @ ${ci} of ${this.pcodes.length}`);
        }

        p.run(code);
      },

      getUsernameColor(username) {
        let hash = 7;
        for (let i = 0; i < username.length; i++) {
          hash = username.charCodeAt(i) + (hash << 5) - hash;
        }
        const index = Math.abs(hash % COLORS.length);
        return COLORS[index];
      },

      pushMessage(target = 'local', data = {}) {
        if (target == 'local') {
          this.inputHistory.push(this.currentInput);
          setTimeout(() => {
            const sc = document.querySelectorAll('.user');
            const sb = document.querySelectorAll('.fixed-pane.bottom')[0];
            if (sc.length > 0) {
              sc[0].scrollTop = sc[0].scrollHeight - (sc[0].clientHeight + sc[0].getBoundingClientRect().top) + sb.clientHeight;
            }
          }, 100);
        } else if (target == 'server') {
          const { username, message, timestamp } = data;
          const color = this.getUsernameColor(username);

          this.serverHistory.push({
            username, message, timestamp, color
          });
          this.runPCode(message);
          setTimeout(() => {
            const sc = document.querySelectorAll('.server')[0];
            const sb = document.querySelectorAll('.fixed-pane.bottom')[0];
            sc.scrollTop = sc.scrollHeight - (sc.clientHeight + sc.getBoundingClientRect().top) + sb.clientHeight;
          }, 100);
        } else if (target == 'typing') {
          // TODO
        }
      },

      checkInputAsCommand() {
        const isLocal = /^\$ .+/.test(this.currentInput);
        const isServer = /^\$$ .+/.test(this.currentInput);

        if (isServer) {
          // TODO:
        } else if (isLocal) {
          // TODO:
          if (this.currentInput.indexOf('$ help') == 0) {
            this.showHelp = !this.showHelp;
          }
        }

        console.log(
          `local meta?${isLocal}, server meta?${isServer}`
        );

        return [isLocal, isServer];
      },

      autoFocus(e) {
        const modifier = (e.ctrlKey || e.altKey || e.metaKey);
        const aEl = document.activeElement;
        const tEl = this.isLogin ? document.querySelector('input') : document.querySelector('input.usernameInput');
        if (aEl != tEl && !modifier) {
          tEl.focus();
        }
      },

      downAction(e) {
        const modifier = e.shiftKey ? 2 : 1;
        let opMode = 0;

        switch (e.code) {
        case 'ArrowUp':
          opMode = -1 * modifier;
          break;
        case 'ArrowDown':
          opMode = 1 * modifier;
          break;
        default:
          break;
        }

        if (opMode == 1 && this.localHistoryIndex < this.inputHistory.length - 1) {
          this.localHistoryIndex ++;
          this.currentInput = this.inputHistory[this.localHistoryIndex];
          this.showHistory = 'local';
        }

        if (opMode == -1 && this.localHistoryIndex > 0) {
          this.localHistoryIndex --;
          this.currentInput = this.inputHistory[this.localHistoryIndex];
          this.showHistory = 'local';
        }

        if (opMode == 2 && this.serverHistoryIndex < this.serverHistory.length - 1) {
          this.serverHistoryIndex ++;
          this.currentInput = this.serverHistory[this.serverHistoryIndex].message;
          this.showHistory = 'server';
        }

        if (opMode == -2 && this.serverHistoryIndex > 0) {
          this.serverHistoryIndex --;
          this.currentInput = this.serverHistory[this.serverHistoryIndex].message;
          this.showHistory = 'server';
        }
      },

      upAction(e) {
        if (
          e.code == 'Enter' && this.currentInput.length > 0
        ) {
          const [isLocalCmd, isServerCmd] = this.checkInputAsCommand();
          this.pushMessage();

          if (!isLocalCmd) {
            this.sio.emit('new message', this.currentInput);
            this.sio.emit('stop typing');
          }

          this.currentInput = '';
          this.localHistoryIndex = this.inputHistory.length;
        } else if(e.code == 'Escape') {
          if (!this.showHelp && this.showHistory) {
            this.showHistory = false;
            this.serverHistoryIndex = this.serverHistory.length;
          }
          if (this.showHelp) this.showHelp = false;
        } else if (e.code == 'ArrowUp' && e.shiftKey) {
          if (this.serverHistoryIndex == 0) {
            const startFrom = this.serverHistory.length == 0 ? 'now' : this.serverHistory[0].timestamp;
            console.log('please more server log!', startFrom);
            this.sio.emit(
              'new message',
              `\$\$ H ${startFrom},10`
            );
          }
        } else {
          // ...
          console.log(e.code);
          // -
          this.sio.emit('typing');
        }
      },

      loginAction(e) {
        if (
          e.code == 'Enter' && this.userName.length > 0
        ) {
          this.currentInput = '';
          (async () => {
            try {
              const res = await window.fetch('/join', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username: this.userName })
              });
              const rjson = await res.json();
              const { status } = rjson;

              if (status) {
                this.initSocket();
                this.sio.emit('add user', this.userName);
                this.isLogin = true;
              }
            } catch(err) {
              console.error(err);
            }
          })();
        }
      }
    };
  }
};

// window.addEventListener('DOMContentLoaded', () => {
// });
