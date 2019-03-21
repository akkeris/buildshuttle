const test = require('./support/init.js')
const request = require('request-promise-native')
const expect = require("chai").expect;

describe("builds logs", function() {
  this.timeout(100000);
  let pending = false
  let successful = false
  let url = null
  test.events.on('loaded', (u) => { url = u });
  it("test to ensure logs arrive iteratively", async () => {
    test.events.removeAllListeners('callback')
    let listener = (body) => {
      expect(body.id).equal(1)
      expect(body.type).equal("buildshuttle")
      if(body.status === "pending") {
        pending = true;
      } else if (body.status === "succeeded") {
        successful = true;
      } else {
        expect(false).to.equal(true);
      }
    }
    test.events.on('callback', listener)
    while(url === null) {
      await new Promise((res, rej) => setTimeout(res, 1000));
    }
    await request(
    {
      "method":"post",
      "headers":{
        "content-type":"application/json"
      },
      "uri":"http://localhost:9000",
      "body":JSON.stringify({
        "sources":"https://github.com/akkeris/build-app-test-repo/archive/without-wait.zip",
        "app":"test",
        "space":"test",
        "app_uuid":"abbce159-87a7-437f-bed3-2da4e44dcfff",
        "gm_registry_host":process.env.DOCKER_HOST || "docker.io",
        "gm_registry_repo":process.env.DOCKER_ORG || "akkeris",
        "gm_registry_auth":{
          "username":process.env.DOCKER_LOGIN,
          "password":process.env.DOCKER_PASS
        },
        "build_number":1,
        "build_uuid":"56bce159-87a7-437f-bed3-2da4e44dffff",
        "callback":url,
        "callback_auth":"foobar",
        "build_args":{
          "@#$JLKSMDVAdjfklasdjfklasj][w]e[232\"\'":"foo",
          "SOME_BUILD_ARG":"\n Fu\nGAZI\n ",
          "SOME_OTHER_ARG":"not_foo",
        }
      })
    });
    let changed = 0;
    let logs = null;
    try {
      logs = await request({"url":"http://localhost:9000/test-abbce159-87a7-437f-bed3-2da4e44dcfff/1/logs"})
    } catch (e) {}
    while(pending === false) {
      try {
        let l = await request({"url":"http://localhost:9000/test-abbce159-87a7-437f-bed3-2da4e44dcfff/1/logs"})
        if (logs !== l) {
          changed++;
        }
      } catch (e) {}
      await test.wait(2000)
    }
    while(successful === false) {
      let l = await request({"url":"http://localhost:9000/test-abbce159-87a7-437f-bed3-2da4e44dcfff/1/logs"})
      if (logs !== l) {
        changed++;
      }
      await test.wait(2000)
    }
    expect(changed).to.not.equal(0);
    test.events.removeListener('callback', listener)
    test.events.removeAllListeners('callback')
    await test.wait(2000)
  });

  it("test to ensure logs arrive through kafka", (done) => {
    test.events.removeAllListeners('kafka')
    let listener = function(event) {
      expect(event.topic).to.equal("alamoweblogs")
      expect(event.messages).to.be.an('array')
      event.messages.forEach((msg) => {
        msg = JSON.parse(msg);
        expect(msg.metadata).to.equal("test-test")
        expect(msg.build).to.equal(1)
        expect(msg.job).to.equal(1)
        expect(msg.message).is.a('string')
      })
      test.events.removeListener('kafka', listener)
      test.events.removeAllListeners('kafka')
      done()
    }
    test.events.on('kafka', listener)
    request(
    {
      "method":"post",
      "headers":{
        "content-type":"application/json"
      },
      "uri":"http://localhost:9000",
      "body":JSON.stringify({
        "sources":"https://github.com/akkeris/build-app-test-repo/archive/without-wait.zip",
        "app":"test",
        "space":"test",
        "app_uuid":"abbce159-87a7-437f-bed3-2da4e44dcfff",
        "kafka_hosts":"nonexistant",
        "gm_registry_host":process.env.DOCKER_HOST || "docker.io",
        "gm_registry_repo":process.env.DOCKER_ORG || "akkeris",
        "gm_registry_auth":{
          "username":process.env.DOCKER_LOGIN,
          "password":process.env.DOCKER_PASS
        },
        "build_number":1,
        "build_uuid":"56bce159-87a7-437f-bed3-2da4e44dffff",
        "callback":url,
        "callback_auth":"foobar",
        "build_args":{
          "@#$JLKSMDVAdjfklasdjfklasj][w]e[232\"\'":"foo",
          "SOME_BUILD_ARG":"\n Fu\nGAZI\n ",
          "SOME_OTHER_ARG":"not_foo",
        }
      })
    });

  });
});