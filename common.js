const request = require('request');
const kafka = require('kafka-node');
const dockerode = require('dockerode');
const docker = new dockerode({socketPath: '/var/run/docker.sock'});
const aws = require('aws-sdk');

let logStreams = {}
let logIntervals = {}
let producers = {}

async function haveObject(Key) {
  try {
    await (new aws.S3({accessKeyId:process.env.S3_ACCESS_KEY, secretAccessKey:process.env.S3_SECRET_KEY}))
      .headObject({Bucket:process.env.S3_BUCKET, Key})
      .promise()
    return true;
  } catch (e) {
    return false
  }
}

async function getObject(Key) {
  return await (new aws.S3({accessKeyId:process.env.S3_ACCESS_KEY, secretAccessKey:process.env.S3_SECRET_KEY}))
    .getObject({ Bucket:process.env.S3_BUCKET, Key})
    .createReadStream()
}

async function putObject(Key, Body) {
  return await (new aws.S3({accessKeyId:process.env.S3_ACCESS_KEY, secretAccessKey:process.env.S3_SECRET_KEY}))
    .putObject({ Bucket:process.env.S3_BUCKET, Key, ACL:'authenticated-read', ContentType:'application/octet-stream', Body})
    .promise()
}

async function follow(stream, onProgress) {
  return new Promise((resolve, reject) => docker.modem.followProgress(stream, (err, output) => err ? reject(err) : resolve(output), onProgress))
}

function checkQueue(kafkaHost) {
  if(!producers[kafkaHost]) {
    return console.error(`Error, we started checking a queue that doesnt exist: ${kafkaHost}`)
  }
  if(producers[kafkaHost].queue.length > 0) {
    let messages = producers[kafkaHost].queue.map((x) => {
      let message = `${x.type}:${(x.event.status || '')} ${(x.event.progress || '' )}${(x.event.stream || '')}`;
      return JSON.stringify({"metadata":`${x.app}-${x.space}`, build:x.build, job:x.build, message})
    });
    producer.send({"topic":"alamoweblogs", messages}, (err) => { 
      if(err) {
        console.error(`Unable to send traffic to kafka:\n${$err}`)
      }
    })
    producers[kafkaHost].queue = []
  }
  setTimeout(checkQueue.bind(null, kafkaHost), 2000);
}

function getKafkaSendingQueue(kafkaHost) {
  if (!kafkaHost) {
    return {queue:[]}; // return a dummy queue.
  }
  if ( !producers[kafkaHost] ) {
    producers[kafkaHost] = { producer:new kafka.Producer(new kafka.KafkaClient({kafkaHost})), queue:[] }
    producers[kafkaHost].on('ready', () => checkQueue.bind(null, kafkaHost))
  }
  return producers[kafkaHost]
}

async function flushLogsToS3(build_uuid) {
  putObject(`${build_uuid}.logs`, logStreams[build_uuid])
  logIntervals[build_uuid] = null;
}

async function sendLogsToS3(payload, event) {
  if(event.stream) {
    event.stream = event.stream.replace(/\n/g, ' ')
  }
  if(!logIntervals[payload.build_uuid]) {
    logIntervals[payload.build_uuid] = setTimeout(flushLogsToS3.bind(null, payload.build_uuid), 2000);
  }
  if(!logStreams[payload.build_uuid]) {
    logStreams[payload.build_uuid] = '';
  }
  logStreams[payload.build_uuid] += `${event.type}:${(event.status || '')} ${(event.progress || '' )}${(event.stream || '')}\n`;
}

async function sendLogsToKafka(kafkaHost, type, app, space, build, event) {
  if(event.stream) {
    event.stream = event.stream.replace(/\n/g, ' ')
  } 
  getKafkaSendingQueue(kafkaHost).queue.push({ type, app, space, build, event })
}

async function sendLogs(payload, type, event) {
  event.type = type;
  sendLogsToKafka(payload.kafka_hosts, event.type, payload.app, payload.space, payload.build_number, event);
  sendLogsToS3(payload, event)
}

async function closeLogs(payload) {
  logStreams[payload.build_uuid] = null;
  logIntervals[payload.build_uuid] = null;
}

async function sendStatus(url, authorization, id, status, building) {
  console.warn(`sending status to ${url} [${authorization}] ${id} ${status} ${building}`)
  try {
    if(url) {
      request({url, headers:{authorization, "content-type":"application/json"}, method:"post", body:JSON.stringify({id, status, building, "type":"buildshuttle"})})
    }
  } catch (e) {
    console.error(`Unable to send callback status to ${url}`)
    console.error(e)
  }
}

module.exports = {
  haveObject,
  getObject,
  putObject,
  sendStatus,
  sendLogs,
  sendLogsToKafka,
  closeLogsToS3,
  closeLogs,
  sendLogsToS3,
  follow,
}