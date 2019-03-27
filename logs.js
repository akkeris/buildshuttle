const fs = require("fs");
const common = require("./common.js");
const debug = require('debug')('buildshuttle-worker');
let kafka = require("kafka-node");
if(process.env.TEST_MODE) {
  kafka = require("./test/support/kafka-mock.js");
}

let kafkaConnection = null;
let logInterval = null;
let logStream = "";

function eventLogMessage(event) {
  let message = [event.status, event.progress, event.stream].filter((x) => !!x).reduce((a, arg) => `${a} ${arg}`, "").trim();
  if(message !== "") {
    message = `${message}\n`;
  }
  return message;
}

function open(payload) {
  debug(`opening logging end points`);
  return new Promise((resolve, reject) => {
    try {
      if(payload.kafka_hosts) {
        debug(`connecting to kafka on ${payload.kafka_hosts}`);
        kafkaConnection = new kafka.Producer(new kafka.KafkaClient({kafkaHost:payload.kafka_hosts}), {"requireAcks":0});
        kafkaConnection.on('ready', () => {
          debug(`connected to kafka on ${payload.kafka_hosts}`);
          resolve();
        });
        kafkaConnection.on("error", (e) => {
          console.log(`A kafka error occured: ${e.message}\n${e.stack}`);
          process.exit(1);
        });
      } else {
        debug(`kafka was not provided, not streaming logs`);
        resolve();
      }
    } catch (e) {
      console.log(e);
      reject(e);
    }
  });
}

function sendLogsToKafka(type, app, space, build_number, event) {
  return new Promise((resolve, reject) => {
    if(kafkaConnection) {
      kafkaConnection.send([{"topic":"alamoweblogs", "messages":[JSON.stringify({
          "metadata":`${app}-${space}`, 
          "build":build_number, 
          "job":build_number,
          "message":eventLogMessage(event),
        })]}], (err) => {
          if(err) {
            console.log(`Unable to send traffic to kafka: ${e.message}\n${e.stack}`);
            process.exit(1);
          }
          resolve();
      });
    } else {
      resolve();
    }
  })
}

async function flushLogsToS3(payload) {
  logInterval = null;
  if(logStream) {
    await common.putObject(`${payload.app}-${payload.app_uuid}-${payload.build_number}.logs`, logStream);
  }
}

async function sendLogsToS3(payload, event) {
  if(!logInterval) {
    logInterval = setTimeout(flushLogsToS3.bind(null, payload), 3000);
  }
  logStream += eventLogMessage(event);
}

async function close(payload) {
  debug(`closing and flushing logs for ${payload.build_uuid}`);
  await flushLogsToS3(payload);
  await sendLogsToKafka('finished', payload.app, payload.space, payload.build_number, {"stream":"Build finished"});
}

async function send(payload, type, event) {
  try {
    if(event.stream) {
      event.stream = event.stream.toString().replace(/^[\n]+|[\n]+$/g, "");
    }
    if(event.status) {
      event.status = event.status.toString().replace(/^[\n]+|[\n]+$/g, "");
    }
    if(event.progress) {
      event.progress = event.progress.toString().replace(/^[\n]+|[\n]+$/g, "");
    }
    event.type = type;
    await sendLogsToKafka(event.type, payload.app, payload.space, payload.build_number, event);
    await sendLogsToS3(payload, event);
  } catch (e) {
    console.log(`Error sending logs ${e.message}\n${e.stack}`)
  }
}

module.exports = {
  send,
  close,
  open,
}
