const WEBR_URL = 'https://webr.r-wasm.org/v0.1.1/';
const PKG_URL = 'https://repo.r-wasm.org/';

// Load webR worker thread and add new communication channel
importScripts(`${WEBR_URL}webr-worker.js`);
chan = {
    setDispatchHandler: () => {}, // Not required (see inputOrDispatch)
    run: (args) => Module.callMain(args), // Start executing Wasm R immediately
    setInterrupt: () => {}, // No support for interrupting R code
    handleInterrupt: () => {},
    resolve: () => { self.resolve() }, // Resolve webRPromise once ready to use
    inputOrDispatch: () => 0, // No interactive stdin, just return NULL
    write: (msg, transfer) => self.postMessage(msg, transfer), // Send webR message to main thread
}

self.webRPromise;
self.resolve;

async function loadWebR() {
    if(self.webRPromise) {
        return self.webRPromise;
    }
    self.webRPromise = new Promise(async (resolve,reject) => {
        self.resolve = resolve;
        init({
            RArgs: [],
            REnv: {
                R_HOME: '/usr/lib/R',
                R_ENABLE_JIT: '0',
            },
            baseUrl: WEBR_URL,
            repoUrl: PKG_URL,
            homedir: '/home/web_user',
        });
    });
    return self.webRPromise;
}

self.namespaces = {};
self.get_namespace = function(id) {
    if(self.namespaces[id] === undefined) {
        self.namespaces[id] = new REnvironment();
        protect(self.namespaces[id]); // Prevent R GC-ing the new environment object
    }
    return self.namespaces[id];
}

self.onmessage = async (event) => {
    await loadWebR();
    switch(event.data.command) {
        case 'runR':
            const { job_id, code, namespace_id } = event.data;
            self.stdout = [];
            self.stderr = [];

            const namespace = self.get_namespace(namespace_id);
            const prot = { n: 0 };
            // Run the R code in the given environment, capturing output and errors, with R autoprint.
            let ret = captureR(code, {
                env: { payloadType: 'ptr', obj: { type: 'environment', ptr: namespace.ptr } },
                withAutoprint: true,
                throwJsException: false
            });
            protectInc(ret, prot); // Prevent R GC-ing the results
            try {
                // Convert results object into resulting object and lines of output
                let result = ret.get('result');
                let output = ret.get('output').toArray().map((out) => {
                    const type = out.get('type').toString();
                    const data = out.get('data');
                    if (type === 'stdout' || type == 'stderr') {
                        return { type: type, data: data.toString() };
                    } else if (type === 'warning' || type === 'message') {
                        return { type: 'stderr', data: data.get('message').toString() };
                    } else if (type === 'error') {
                        throw new Error(data.get('message').toString());
                    }
                });
                self.stdout = output.filter((out) => out.type=='stdout').map((out) => out.data);
                self.stderr = output.filter((out) => out.type=='stderr').map((out) => out.data);

                // If returned R object is a logical, convert to JS boolean
                if(result !== undefined && result.type() == 'logical') {
                    result = result.toBoolean();
                }
                // Otherwise try to convert object to JS if possible
                if(isRObject(result)) {
                    try {
                        result = result.toJs();
                    } catch(e) {
                        self.postMessage({
                            conversion_error: `Can't convert from type ${result.type}`,
                            result: null,
                            job_id,
                            unconverted_type: result.type,
                            stdout: self.stdout.join('\n'),
                            stderr: self.stderr.join('\n'),
                        })
                        return;
                    }
                }
                // Reply to the main thread with the result and standard outputs
                chan.write({
                    result,
                    job_id,
                    stdout: self.stdout.join('\n'),
                    stderr: self.stderr.join('\n'),
                });
            } catch (error) {
                // Reply to the main thread with an error if something goes wrong
                chan.write({
                    error: error.message,
                    error_name: error.name,
                    job_id,
                    stdout: self.stdout.join('\n'),
                    stderr: self.stderr.concat([error.message]).filter(x=>x!='').join('\n'),
                });
            } finally {
                unprotect(prot.n); // We're done with the result, allow R to GC it
            }
            break;
    }
};
