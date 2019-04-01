if(process.env.SMOKE_TESTS && process.env.TIMEOUT_TESTS) {
  process.env.TIMEOUT_IN_MS = 10;
  const test = require('./support/init.js')
  const request = require('request-promise-native')
  const expect = require("chai").expect;

  describe("creating builds", function() {
    this.timeout(100000);
    let pending = false
    let failed = false
    let url = null
    test.events.on('loaded', (u) => { url = u });
    
    it("test creating a build", async () => {
      test.events.removeAllListeners('callback')
      let listener = (body) => {
        expect(body.id).equal(1)
        expect(body.type).equal("buildshuttle")
        if(body.status === "pending") {
          pending = true;
        } else if (body.status === "failed") {
          failed = true;
        } else {
          console.log('received unexpected build status:', body.status)
          expect(false).to.equal(true);
        }
      }
      test.events.on('callback', listener)
      while(url === null) {
        await test.wait()
      }
      let response = await request(
      {
        "method":"post",
        "headers":{
          "content-type":"application/json"
        },
        "uri":"http://localhost:9000",
        "body":JSON.stringify({
          "sources":"https://github.com/akkeris/build-app-test-repo/archive/master.zip",
          "app":"test",
          "space":"test",
          "app_uuid":"56bce159-87a7-437f-bed3-2da4e44d9cf3",
          "gm_registry_host":"docker.io",
          "gm_registry_repo":"akkeris",
          "gm_registry_auth":{
            "username":process.env.DOCKER_LOGIN,
            "password":process.env.DOCKER_PASS
          },
          "build_number":1,
          "build_uuid":"56bce159-87a7-437f-bed3-2da4e44d9cf3",
          "callback":url,
          "callback_auth":"foobar"
        })
      });
      expect(response).to.equal('{"status":"ok"}')
      while(pending === false) {
        await test.wait()
      }
      while(failed === false) {
        await test.wait()
      }
      test.events.removeListener('callback', listener)
      test.events.removeAllListeners('callback')
      process.env.TIMEOUT_IN_MS = null;
    });
  })
}