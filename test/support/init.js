const ngrok = require('ngrok');
const express = require('express');
const EventEmitter = require('events');
const app = express();
const child_process = require('child_process');
app.use(require('body-parser').json());

class Events extends EventEmitter {}
const events = new Events();

app.post('/kafka', (req, res) => {
  events.emit('kafka', req.body)
  res.send('ok');
})
app.post('/', (req, res) => {
  events.emit('callback', req.body)
  res.send("ok")
})
app.listen(3000);
process.env.TEST_MODE=true
process.env.PORT=9000

let running_app = null
async function wait(time = 1000) {
  return new Promise((res, rej) => setTimeout(res, time));
}

before(async function() {
  this.timeout(5000)
  if(process.env.NGROK_TOKEN) {
    let url = null
    try {
      process.env.NGROK_URL = url = await ngrok.connect({authtoken:process.env.NGROK_TOKEN, addr:3000})
    } catch (err) {
      console.error("ERROR: Unable to establish NGROK connection:", err);
      return
    }
    running_app = child_process.spawn("node", ["index.js"], {env:process.env, stdio:['inherit', 'inherit', 'inherit']})
    running_app.on('error', (err) => {
      console.error("Error starting up node service")
      console.error(err)
    })
    await wait(1500)
    events.emit('loaded', url)
  } else {
    running_app = child_process.spawn("node","index.js", {env:process.env, stdio:['inherit', 'inherit', 'inherit']})
    await wait(1500)
    events.emit('loaded', 'http://locahost:9000')
  }
})

after(async function() {
  if(running_app) {
    running_app.kill('SIGTERM')
  }
  if(process.env.NGROK_TOKEN) {
    await ngrok.disconnect()
    await ngrok.kill()
  }
})

module.exports = {
  events,
  wait
}
