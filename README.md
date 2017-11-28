# Akkeris Build Shuttle

The build shuttle is a private API used by the app controller to cache builds and abstract out jenkins from the main code body of the app controller.

**NEVER:** Hit these API end points on this directly! 

## Environment Vars:

* `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_LOCATION` - Amazon S3 service to use to store build sources
* `JENKINS_URL` - The backing jenkins instance to use, must have pipeline extensions enabled.
* `BUILD_SHUTTLE_HOST` - The host of the alamo build shuttle.
* `PORT` - The port to listen on

## Starting:

npm start

## Testing

You'll need to set the additional environment variables for running tests:

1. TEST_GM_REGISTRY_HOST - This is the docker private image registry hostname where gold master images are stored.
2. TEST_GM_REGISTRY_REPO - This is the name of the org (not repo) that should be used for gold master images.
3. NGROK_TOKEN - In order to hear callbacks, a NGROK token is necessary, see www.ngrok.com for more information.
4. CODACY_PROJECT_TOKEN - to report code coverage set this token, otherwise reports are produced locally.
5. TEST_MODE=true - Set to true always.

```
npm test
```


## API End points:

`POST /` - PRIVATE

With payload:

```
{
  sha, 
  app,
  space, 
  branch, 
  repo, 
  org, 
  callback,
  build_uuid, 
  app_uuid, 
  sources, 
  build_opts, 
  docker_registry, 
  docker_login, 
  docker_password
}
```

This will trigger a build in jenkins, note bad things happen if you have not setup the following preconditions:

1. Ensure that no build is currently running of the same job.
2. Ensure the job has been created. 
3. Ensured that the build uuid is unique in the postrges app controller db.

The only system that should hit this is the alamo app controller!

`GET /{build_uuid}` - PRIVATE

This will return the payload sources, this is only fetched by jenkins and should not be relied upon by any other system.  Once again private!

`DELETE /{app_name}-{app_uuid}/{build_foreign_key}` - PRIVATE - Stops a build
`DELETE /{app_name}-{app_uuid}` - PRIVATE - Deletes the job
`GET /{app_name}-{app_uuid}/{build_foriegn_key}/status` - PRIVATE - gets the job status `{"building":false, "status":"pending|failed|stopped|succeeded}, "type":"jenkins", "id":1}`
`GET /{app_name}-{app_uuid}/{build_foriegn_key}/logs` - PRIVATE - Gets the logs for the build.

