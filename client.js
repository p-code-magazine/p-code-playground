import { PCode } from '@h4us/p-code';
import io from 'socket.io-client';
import p5 from 'p5';
import 'alpinejs';

const COLORS = [
  '#e21400', '#91580f', '#f8a700', '#f78b00',
  '#58dc00', '#287b00', '#a8f07a', '#4ae8c4',
  '#3b88eb', '#3824aa', '#a700ff', '#d300e7'
];
const MAX_NUM_INSTANCES = 8;

window.appComponents = {
  cmdr() {
    return {
      currentInput: '',
      bus: 'auto',
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
      isSubmit: false,
      //
      pcodes: [],
      p5s: null,
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

      initCmdr() {
        for (let i = 0; i < MAX_NUM_INSTANCES; i++) {
          const p = new PCode({
            defaultVolume: -12,
            comment: { enable: true },
            meta: { enable: true }
          });
          this.pcodes.push(p);
        }

        const ctx = (p) => {
          //! embed in p5
          const _pcodes = this.pcodes;

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

        this.p5s = new p5(ctx);
        this.sio = io();

        this.sio.on('login', (data) => {
          this.numUsers = data.numUsers;
          this.tabText = `server: online[${data.numUsers}]`;
        });
        this.sio.on('new message', (data) => {
          this.pushMessage('server', data);
        });
        this.sio.on('reply command', (data) => {
          const { message = [], action } = data;
          if (action == 'H' && message.length > 0) {
            this.serverHistory.splice(0, 0, ...message.reverse());
            this.serverHistoryIndex = message.length - 1;
            this.showHistory = 'server';
          }

          if (action == 'P' && message.length > 0) {
          }
        });
        this.sio.on('user joined', (data) => {
          this.numUsers = data.numUsers;
          this.tabText = `server: online[${data.numUsers}]`;
        });
        this.sio.on('user left', (data) => {
          this.numUsers = data.numUsers;
          this.tabText = `server: online[${data.numUsers}]`;
        });
        this.sio.on('typing', (data) => {
          if (this.typingUsers.findIndex((el) => el == data.username) < 0) {
            this.typingUsers.push(data.username);
          }

          this.tabText = `server: online[${data.numUsers}] | ${this.typingUsers.join(',')} typing..`;
        });
        this.sio.on('disconnect', () => {
          console.info('you have been disconnected');
        });
        this.sio.on('reconnect', () => {
          if (this.userName.length > 0) {
            this.sio.emit('add user', this.userName);
          }
          console.info('you have been reconnected');
        });

        this.sio.emit('add user', this.userName);
        this.isLogin = true;
      },

      runPCode(code, bus = 0) {
        const _bus = parseInt(bus);
        if (_bus >= 0 && _bus < this.pcodes.length) {
          this.pcodes[bus].run(code);
        }
      },

      getUsernameColor(username) {
        let hash = 7;
        for (let i = 0; i < username.length; i++) {
          hash = username.charCodeAt(i) + (hash << 5) - hash;
        }
        const index = Math.abs(hash % COLORS.length);
        return COLORS[index];
      },

      selectBus() {
        let b = 0;

        if (this.bus == 'auto') {
          let p = this.pcodes[0];
          for (let i in this.pcodes) {
            if (i > 0) {
              if (p.lastEvaluateTime > this.pcodes[i].lastEvaluateTime) {
                p = this.pcodes[i];
                b = i;
              }
            }
          }
        } else {
          b = this.bus;
        }

        return b;
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
          let {
            username, message, timestamp,
            bus = 0,
            color = ''
          } = data;

          color = (color.length == '') ? this.getUsernameColor(username) : color;

          this.serverHistory.push({
            username, message, timestamp, color, bus
          });
          this.runPCode(message, bus);

          setTimeout(() => {
            const sc = document.querySelectorAll('.server')[0];
            const sb = document.querySelectorAll('.fixed-pane.bottom')[0];
            sc.scrollTop = sc.scrollHeight - (sc.clientHeight + sc.getBoundingClientRect().top) + sb.clientHeight;
          }, 100);
        }
      },

      checkInputAsCommand() {
        const isLocal = /^\$ .+/.test(this.currentInput);
        const isServer = /^\$$ .+/.test(this.currentInput);

        if (isServer) {
          // TODO:
        } else if (isLocal) {
          //! show help
          if (this.currentInput.indexOf('$ help') == 0) {
            this.showHelp = !this.showHelp;
          }
          //! set audio bus
          if (this.currentInput.indexOf('$ bus') == 0) {
            const bVal = this.currentInput.replace('$ bus ', '');
            const bNum = parseInt(bVal);
            if (!isNaN(bNum) && bNum < this.pcodes.length && bNum >= 0) {
              this.bus = bNum;
            } else if (bVal == 'auto') {
              this.bus = 'auto';
            }
          }
        }

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
        const keycode = e.code || e.key;
        let opMode = 0;

        // a.
        if (e.which == 13 && this.currentInput.length > 0) {
          const [isLocalCmd, isServerCmd] = this.checkInputAsCommand();
          this.pushMessage();

          if (!isLocalCmd) {
            this.sio.emit(
              'new message', {
                message: this.currentInput,
                bus: this.selectBus()
              }
            );
          }

          this.currentInput = '';
          this.localHistoryIndex = this.inputHistory.length;
          return;
        }

        // b.
        switch (keycode) {
        case 'ArrowUp':
          opMode = -1 * modifier;
          break;
        case 'ArrowDown':
          opMode = 1 * modifier;
          break;
        default:
          break;
        }

        if (opMode == 1 || opMode == -1 || opMode == 2 || opMode == -2) {
          const q = (modifier == 2) ? '.user.public' : '.user.local';
          const hl = (modifier == 2) ? this.serverHistory.length : this.inputHistory.length;
          let idx = 0;

          if (hl == 0) { return; }
          this.showHistory = (modifier == 2) ? 'server' : 'local';

          if (opMode == 1) {
            this.localHistoryIndex = Math.min(this.inputHistory.length - 1, this.localHistoryIndex + 1);
            this.currentInput = this.inputHistory[this.localHistoryIndex];
          }
          if (opMode == -1) {
            this.localHistoryIndex = Math.max(0, this.localHistoryIndex - 1);
            this.currentInput = this.inputHistory[this.localHistoryIndex];
          }

          if (opMode == 2) {
            this.serverHistoryIndex = Math.min(this.serverHistory.length - 1, this.serverHistoryIndex + 1);
            this.currentInput = this.serverHistory[this.serverHistoryIndex].message;
          }
          if (opMode == -2) {
            this.serverHistoryIndex = Math.max(0, this.serverHistoryIndex - 1);
            this.currentInput = this.serverHistory[this.serverHistoryIndex].message;
          }

          idx = (modifier == 2) ? this.serverHistoryIndex : this.localHistoryIndex;

          this.$nextTick(() => {
            const sc = document.querySelector(q);
            const scl = document.querySelectorAll(`${q} .item`);
            if (scl.length > 0) {
              const sci = scl[idx];
              if ((sci.getBoundingClientRect().top - sci.clientHeight) < 0) {
                sc.scrollTop += sci.getBoundingClientRect().top - sci.clientHeight;
              } else if((sci.getBoundingClientRect().top + sci.clientHeight) > sc.clientHeight)  {
                sc.scrollTop += (sci.getBoundingClientRect().top - sc.clientHeight + sci.clientHeight);
              }
            }
          });
        }
      },

      upAction(e) {
        const keycode = e.code || e.key;

        if(keycode == 'Escape') {
          if (!this.showHelp && this.showHistory) {
            this.showHistory = false;
            this.serverHistoryIndex = this.serverHistory.length;
          }
          if (this.showHelp) this.showHelp = false;
        } else if (keycode == 'ArrowUp' && e.shiftKey) {
          if (this.serverHistoryIndex == 0) {
            const untilTo = (this.serverHistory.length == 0) ? 'now' : this.serverHistory[0].timestamp;
            this.sio.emit(
              'new message',
              `\$\$ H ${untilTo},10`
            );
          }
        } else {
          // ...
          // console.log(e);
          // -
          this.sio.emit('typing');
        }
      },

      loginAction(e) {
        if (e.which == 13 && this.userName.length > 0 && !this.isSubmit) {
          this.currentInput = '';
          this.isSubmit = true;

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
                this.initCmdr();
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
