const k8s = require('@kubernetes/client-node');
const kc = new k8s.KubeConfig();
const utils = require('util');
kc.loadFromDefault();

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
const k8sLogs = new k8s.Log(kc);
const interval = 100; /* The interval between requesting logs, and checking for if a pod is created/dead */
const maxIteration = 300; /* The maximum iterations seperated by interval(ms) to check for if a  pod is created/dead */


function exitCodeFromPod(podInfo) {
	if( podInfo.status.containerStatuses && 
		podInfo.status.containerStatuses[0] &&
		podInfo.status.containerStatuses[0].state &&
		podInfo.status.containerStatuses[0].state.terminated &&
		podInfo.status.containerStatuses[0].state.terminated.exitCode) 
	{
		return podInfo.status.containerStatuses[0].state.terminated.exitCode
	} else {
		return 0
	}
}

async function pipeLogs(logs, k8s, namespace, pod, container, stream, options, counter) {
	return new Promise((resolve, reject) => {
		counter = counter || 1;
		options = options || {};
		options.follow = true;
		options.timestamps = false;
		if (counter >= maxIteration) {
			return reject(new Error('Error timing out waiting for pod to come alive.'));
		}
		logs.log(namespace, pod, container, stream, async (res) => {
			try {
				if(typeof res === "string") {
					res = JSON.parse(res)
				}
				if(res && res.kind === "Status" && res.status === "Failure" && res.message.includes("ContainerCreating")) {
					await new Promise((r) => setTimeout(r, interval));
					return resolve(await pipeLogs(logs, k8s, namespace, pod, container, stream, options, counter++))
				} else {
					for(let i=0; i < maxIteration; i++) {
						await new Promise((r) => setTimeout(r, interval));
						let podInfo = await k8s.readNamespacedPod(pod, namespace, true);
						if(podInfo.body && podInfo.body.status && podInfo.body.status.phase && podInfo.body.status.phase !== "Running") {
							return resolve({"pod":podInfo.body, exitCode:exitCodeFromPod(podInfo.body)});
						}
					}
					return reject(new Error('Error timing out waiting for pod to stop.'));
				}
			} catch (e) {
				return reject(e)
			}
		}, options)
	})
}

async function run(podName, namespace, serviceAccountName, image, command, env, stream) {
	stream = stream || process.stdout
	let pod = new k8s.V1Pod()
	pod.apiVersion = "v1"
	pod.kind = "Pod"
	pod.metadata = new k8s.V1ObjectMeta()
	pod.metadata.namespace = namespace
	pod.metadata.name = podName
	pod.spec = new k8s.V1PodSpec()
	pod.spec.restartPolicy = "Never"
	pod.spec.activeDeadlineSeconds = 20 * 60 // timeout 
	pod.spec.affinity = new k8s.V1Affinity()
	pod.spec.affinity.nodeAffinity = new k8s.V1NodeAffinity()
	pod.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution = [new k8s.V1PreferredSchedulingTerm()]
	pod.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].weight = 1
	pod.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].preference = new k8s.V1NodeSelectorTerm()
	pod.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].preference.matchExpressions = [new k8s.V1NodeSelectorRequirement()]
	pod.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].preference.matchExpressions[0].key = "akkeris.io/node-role"
	pod.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].preference.matchExpressions[0].operator = "In"
	pod.spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0].preference.matchExpressions[0].values = ["build"]
	pod.spec.serviceAccount = serviceAccountName
	pod.spec.serviceAccountName = serviceAccountName
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
	pod.spec.containers[0].resources.limits = {"memory":"128Mi", "cpu":"500m"}
	pod.spec.containers[0].resources.requests = {"memory":"128Mi", "cpu":"500m"}
	pod.spec.containers[0].image = image
	pod.spec.containers[0].imagePullPolicy = "Always"

	try {
		await k8sApi.createNamespacedPod(namespace, pod, true, true)
		return await pipeLogs(k8sLogs, k8sApi, namespace, podName, podName, stream, {})
	} catch (e) {
		if(e.response && e.response.body) {
			throw new Error("Kubernetes failed to create or listen to pod: " + e.response.body.message + " " + e.response.body.code)
		} else {
			throw e
		}
	} finally {
		await k8sApi.deleteNamespacedPod(podName, namespace, false, null, false, 30)	
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
		return await k8sApi.readNamespacedPodLog(podName, namespace, podName, false)
	} catch (e) {
		if(e.body && e.body.code && (e.body.code === 404 || e.body.code === 400)) {
			return ""
		} else {
			throw e
		}
	}
}

module.exports = {run, stop, logs}

// Location notes for kubernetes interfaces.
// api.js:3120: V1Container class
// api.js:6844: V1ObjectMeta class
// api.js:7429; V1Pod class
// api.js:7724; V1PodSpec class
// api.js:57251: readNamespacedPodLog(name, namespace, container, follow, limitBytes, pretty, previous, sinceSeconds, tailLines, timestamps, options = {})
// api.js:49398: createNamespacedPod(namespace, body, includeUninitialized, pretty, dryRun, options = {})
