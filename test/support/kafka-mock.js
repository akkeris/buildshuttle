/* eslint-disable class-methods-use-this */
const request = require('request');

class Producer {
  on(event, cb) {
    if (event === 'ready') {
      cb();
    }
  }

  send(obj, cb) {
    const url = process.env.NGROK_URL || 'http://localhost:3000';
    request({
      method: 'post', url: (`${url}/kafka`), body: JSON.stringify(obj), headers: { 'content-type': 'application/json' },
    });
    cb();
  }
}

module.exports = {
  KafkaClient() {},
  Producer,
};
