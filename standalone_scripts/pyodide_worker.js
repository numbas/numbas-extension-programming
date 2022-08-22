importScripts("https://cdn.jsdelivr.net/pyodide/v0.21.0/full/pyodide.js");

self.stdout = [];
self.stderr = [];

self.pyodidePromise;

async function init() {
    if(self.pyodidePromise) {
        return self.pyodidePromise;
    }
    self.pyodidePromise = new Promise(async (resolve,reject) => {
        self.pyodide = await loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.21.0/full/",
            stdout: s => self.stdout.push(s),
            stderr: s => self.stderr.push(s)
        });
        self.pyodide.runPython("import os; os.environ['MPLBACKEND'] = 'AGG'");
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

            self.stdout = [];
            self.stderr = [];

            const namespace = await self.get_namespace(namespace_id);

            try {
                await self.pyodide.loadPackagesFromImports(code);
                let result = await self.pyodide.runPythonAsync(code, {globals: namespace});
                if(result !== undefined && result.type == 'numpy.bool_') {
                    result = (result+'') == 'True';
                }
                if(pyodide.isPyProxy(result)) {
                    try {
                        result = result.toJs({
                            create_pyproxies: false
                        });
                    } catch(e) {
                        self.postMessage({
                            conversion_error: `Can't convert from type ${result.type}`,
                            result: null,
                            job_id,
                            unconverted_type: result.type,
                            stdout: self.stdout.join('\n'),
                            stderr: self.stderr.join('\n')
                        })
                        return;
                    }
                }
                namespace.set('_',result);
                self.postMessage({
                    result,
                    job_id,
                    stdout: self.stdout.join('\n'),
                    stderr: self.stderr.join('\n')
                });
            } catch (error) {
                self.postMessage({
                    error: error.message,
                    error_name: error.name,
                    job_id,
                    stdout: self.stdout.join('\n'),
                    stderr: self.stderr.concat([error.message]).filter(x=>x!='').join('\n')
                });
            }
            break;
    }
};

