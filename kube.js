const k8s = require('@kubernetes/client-node');
const utils = require('util');
const debug = require("debug")("buildshuttle");

let kc = null; 
let k8sApi = null; 
let k8sLogs = null; 
const interval = 100; /* The interval between requesting logs, and checking for if a pod is created/dead */
const maxIteration = 600; /* The maximum iterations seperated by interval(ms) to check for if a  pod is created/dead */
const timeoutInMs = process.env.TIMEOUT_IN_MS ? parseInt(process.env.TIMEOUT_IN_MS, 10) : (20 * 60 * 1000); // default is 20 minutes.

function exitCodeFromPod(podInfo) {
	if( 
		podInfo &&
		podInfo.status &&
		podInfo.status.containerStatuses && 
		podInfo.status.containerStatuses[0] &&
		podInfo.status.containerStatuses[0].state &&
		podInfo.status.containerStatuses[0].state.terminated &&
		(
			podInfo.status.containerStatuses[0].state.terminated.exitCode || 
			podInfo.status.containerStatuses[0].state.terminated.exitCode === 0
		))
	{
		return podInfo.status.containerStatuses[0].state.terminated.exitCode
	} else {
		debug("Unable to determine worker container status code, assuming successful. " + JSON.stringify(podInfo))
		return 0
	}
}

function init() {
	kc = new k8s.KubeConfig();
	kc.loadFromDefault();
	k8sApi = kc.makeApiClient(k8s.CoreV1Api);
	k8sLogs = new k8s.Log(kc);
}

function pipeLogs(logs, k8s, namespace, pod, container, stream, options) {
	return new Promise(async (resolve, reject) => {
		// Wait for pod to begin.
		loop:
		for(let i=0; i < maxIteration; i++) {
			await new Promise((r) => setTimeout(r, interval));
			let podInfo = await k8s.readNamespacedPod(pod, namespace, true);
			if(podInfo.body && podInfo.body.status && podInfo.body.status.phase) {
				debug("Waiting for build worker to start. Received status: " + JSON.stringify(podInfo.body.status))
				if(podInfo.body.status.phase !== "Pending" && podInfo.body.status.phase !== "Unknown") {
					break loop;
				}
			}
			if(i === (maxIteration - 1)) {
				return reject(new Error("The buildshuttle worker failed to start on a kubernetes pod."))
			}
		}
		debug(`Streaming build logs from pod ${pod} container ${container} in ${namespace}.`)
		logs.log(namespace, pod, container, stream, async (res) => {
			debug("Received response for logging request from kubernetes: " + JSON.stringify(res));
			try {
				if(res !== null) {
					// For one reason or another getting logs failed. Either a network error
					// occured or the response is a failed http status code (e.g != 200)
					return reject(res);
				}
				// The stream was successful, no message is a good message.
				for(let i=0; i < maxIteration; i++) {
					await new Promise((r) => setTimeout(r, interval));
					let podInfo = await k8s.readNamespacedPod(pod, namespace, true);
					if(podInfo.body && podInfo.body.status && podInfo.body.status.phase) {
						debug("Waiting for build worker to stop. Received status: " + JSON.stringify(podInfo.body.status))
						if(podInfo.body.status.phase === "Succeeded") {
							return resolve({"pod":podInfo.body, exitCode:exitCodeFromPod(podInfo.body)});
						} else if (podInfo.body.status.phase === "Failed") {
							return resolve({"pod":podInfo.body, exitCode:1});
						} else if (podInfo.body.status.phase === "Unknown") {
							return reject(new Error("The status of the buildshuttle pod could not be obtained."))
						}
					}
				}
				return reject(new Error('Error timing out waiting for pod to stop.'));
			} catch (e) {
				return reject(e)
			}
		}, options || {})
	})
}

let testModeLogs = {}

async function run(podName, namespace, serviceAccountName, image, command, env, stream) {
	stream = stream || process.stdout
	let pod = new k8s.V1Pod()
	pod.apiVersion = "v1"
	pod.kind = "Pod"
	pod.metadata = new k8s.V1ObjectMeta()
	pod.metadata.labels = {
		"name": "buildshuttle-worker"
	}
	pod.metadata.namespace = namespace
	pod.metadata.name = podName
	pod.spec = new k8s.V1PodSpec()
	pod.spec.restartPolicy = "Never"
	pod.spec.activeDeadlineSeconds = Math.round(timeoutInMs / 1000) // timeout 
	pod.spec.affinity = new k8s.V1Affinity()
	pod.spec.affinity.nodeAffinity = new k8s.V1NodeAffinity()
	pod.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution = [new k8s.V1PreferredSchedulingTerm()]
	pod.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].weight = 1
	pod.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].preference = new k8s.V1NodeSelectorTerm()
	pod.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].preference.matchExpressions = [new k8s.V1NodeSelectorRequirement()]
	pod.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].preference.matchExpressions[0].key = "akkeris.io/node-role"
	pod.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].preference.matchExpressions[0].operator = "In"
	pod.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].preference.matchExpressions[0].values = ["build"]
	pod.spec.containers = [new k8s.V1Container()]
	pod.spec.containers[0].command = command
	pod.spec.containers[0].name = podName
	pod.spec.containers[0].env = []
	for (let k in env) {
		let envVar = new k8s.V1EnvVar()
		envVar.name = k
		envVar.value = env[k]
		pod.spec.containers[0].env.push(envVar)
	}
	pod.spec.containers[0].resources = new k8s.V1ResourceRequirements()
	pod.spec.containers[0].resources.limits = {"memory":"256Mi", "cpu":"500m"}
	pod.spec.containers[0].resources.requests = {"memory":"128Mi", "cpu":"500m"}
	pod.spec.containers[0].image = image

	try {
		await k8sApi.createNamespacedPod(namespace, pod, true, true)
		return await pipeLogs(k8sLogs, k8sApi, namespace, podName, podName, stream, {"follow":true, "timestamps":false})
	} catch (e) {
		if(e.response && e.response.body) {
			throw new Error("Kubernetes failed to create or listen to pod: " + e.response.body.message + " " + e.response.body.code)
		} else {
			throw e
		}
	} finally {
		if(process.env.TEST_MODE) {
			try {
				let logs = await k8sApi.readNamespacedPodLog(podName, namespace, podName, false);
				testModeLogs[podName+namespace] = logs.response.body
			} catch (e) {
				// do nothing
			}
		}
		try {
			await k8sApi.deleteNamespacedPod(podName, namespace, undefined, null, undefined, 30)
		} catch (e) {
			console.error(`Unable to remove buildshuttle worker pod: ${JSON.stringify(e)}`)
		}
	}
}

async function stop(podName, namespace) {
	try {
		await k8sApi.deleteNamespacedPod(podName, namespace, false, null, false, 30)
	} catch (e) {
		if(e.body && e.body.code && (e.body.code === 404 || e.body.code === 400)) {
			return ""
		} else {
			throw e
		}
	}
}

async function logs(podName, namespace) {
	try {
		if(testModeLogs[podName+namespace]) {
			return testModeLogs[podName+namespace];
		}
		return JSON.parse(await k8sApi.readNamespacedPodLog(podName, namespace, podName, false)).response.body
	} catch (e) {
		if(e.body && e.body.code && (e.body.code === 404 || e.body.code === 400)) {
			return ""
		} else {
			throw e
		}
	}
}

module.exports = {run, stop, logs, init}

// Location notes for kubernetes interfaces.
// api.js:3120: V1Container class
// api.js:6844: V1ObjectMeta class
// api.js:7429; V1Pod class
// api.js:7724; V1PodSpec class
// api.js:57251: readNamespacedPodLog(name, namespace, container, follow, limitBytes, pretty, previous, sinceSeconds, tailLines, timestamps, options = {})
// api.js:49398: createNamespacedPod(namespace, body, includeUninitialized, pretty, dryRun, options = {})
