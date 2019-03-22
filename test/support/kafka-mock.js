const assert = require('assert');
const request = require('request');
class Producer {
	on(event, cb) {
		if(event === "ready") {
			cb();
		}
	}
	send(obj, cb) {
		let url = process.env.NGROK_URL || 'http://localhost:3000'
		request({method:'post', url:(url + '/kafka'), body:JSON.stringify(obj), headers:{'content-type':'application/json'}})
		cb()
	}
}

module.exports = {
	KafkaClient:function() {},
	Producer
}