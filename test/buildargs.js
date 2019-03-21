const test = require('./support/init.js')
const request = require('request-promise-native')
const expect = require("chai").expect;

describe("builds arguments", function() {
  this.timeout(100000);
  let pending = false
  let successful = false
  let url = null
  test.events.on('loaded', (u) => { url = u });
  it("test whether build args are injected into the build", async () => {
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
        "app_uuid":"bbbce159-87a7-437f-bed3-2da4e44dcccc",
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
    while(pending === false) {
      await test.wait()
    }
    while(successful === false) {
      await test.wait()
    }
    let logs = await request({"url":"http://localhost:9000/test-bbbce159-87a7-437f-bed3-2da4e44dcccc/1/logs"})
    expect(logs).to.include('JLKSMDVAdjfklasdjfklasjwe232=foo')
    let start = false
    logs = logs.split('\n').filter((x) => {
      if(x.startsWith("SOME_BUILD_ARG=")) {
        start = true
      } else if (x.startsWith("Removing") || x.startsWith("--->") || x.startsWith("PWD=")) {
        start = false
      }
      return start
    })
    expect(logs.length).to.equal(4)
    expect(logs.join('\n')).to.equal("SOME_BUILD_ARG=\n Fu\nGAZI\n ")
    test.events.removeListener('callback', listener)
  });
});