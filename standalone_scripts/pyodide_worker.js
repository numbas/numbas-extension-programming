// webworker.js

// Setup your project to serve `py-worker.js`. You should also serve
// `pyodide.js`, and all its associated `.asm.js`, `.data`, `.json`,
// and `.wasm` files as well:
importScripts("https://cdn.jsdelivr.net/pyodide/v0.19.0/full/pyodide.js");


self.stdout = '';
self.stderr = '';

self.pyodidePromise;

async function init() {
    if(self.pyodidePromise) {
        return self.pyodidePromise;
    }
    // for some reason, each call to stdout is made twice, so ignore every other call.
    let stdoutswap = 0;
    self.pyodidePromise = new Promise(async (resolve,reject) => {
        self.pyodide = await loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.19.0/full/",
            stdout: s => {
                stdoutswap = !stdoutswap;
                if(stdoutswap) {
                    self.stdout += s;
                }
            },
            stderr: s => self.stderr += s
        });
        resolve(self.pyodide);
    });
    return self.pyodidePromise;
}

self.namespaces = {};

self.get_namespace = async function(id) {
    if(self.namespaces[id] === undefined) {
        const namespace = await self.pyodide.runPythonAsync('dict()');
        self.namespaces[id] = namespace;
    }
    return self.namespaces[id];
}

self.onmessage = async (event) => {
    await init();

    const {command} = event.data;

    switch(command) {
        case 'setInterruptBuffer':
            self.pyodide.setInterruptBuffer(event.data.interruptBuffer);
            break;
        case 'runPython': 
            const { job_id, code, namespace_id } = event.data;
            console.log(`job ${job_id} in namespace ${namespace_id}: ${code}`);

            self.stdout = '';
            self.stderr = '';

            const namespace = await self.get_namespace(namespace_id);

            try {
                await self.pyodide.loadPackagesFromImports(code);
                let result = await self.pyodide.runPythonAsync(code, namespace);
                self.postMessage({
                    result,
                    job_id,
                    stdout: self.stdout,
                    stderr: self.stderr
                });
            } catch (error) {
                self.postMessage({
                    error: error.message,
                    job_id,
                    stdout: self.stdout,
                    stderr: [self.stderr,error.message].filter(x=>x!='').join('\n')
                });
            }
            break;
    }
};

