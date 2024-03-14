const pyodide_version = 'v0.24.1';
const pyodide_indexURL = `https://cdn.jsdelivr.net/pyodide/${pyodide_version}/full/`;
importScripts(pyodide_indexURL + 'pyodide.js');

self.stdout = [];
self.stderr = [];

self.pyodidePromise = null;

async function init(options, preamble) {
    if(!self.pyodidePromise) {
        preamble = preamble || "import os; os.environ['MPLBACKEND'] = 'AGG'";

        const default_options = {
            indexURL: pyodide_indexURL,
            stdout: s => self.stdout.push(s),
            stderr: s => self.stderr.push(s)
        };
        const final_options = Object.assign(default_options, options);

        self.pyodidePromise = new Promise((resolve,reject) => {
            loadPyodide(final_options).then(pyodide => {
                self.pyodide = pyodide;
                if(options.packages) {
                    self.pyodide.loadPackage(options.packages);
                }
                if(options.files) {
                    init_files(pyodide, options.files);
                }
                self.pyodide.runPython(preamble);
                resolve(self.pyodide);
            });
        });
    }
    return self.pyodidePromise;
}

async function init_files(pyodide, files) {
    const {FS} = pyodide;

    const blobs = await Promise.all(files.map(async (name) => {
        const res = await fetch('../../../resources/question-resources/'+name);
        const blob = await res.blob();
        return {name, data: blob};
    }));

    FS.mkdir('/resources');
    FS.mount(FS.filesystems.WORKERFS, {
      blobs,
      files: [], // Array of File objects or FileList
    }, '/resources');

    return;
}

self.namespaces = {};

self.get_namespace = async function(id) {
    if(self.namespaces[id] === undefined) {
        const namespace = await self.pyodide.runPythonAsync('dict()');
        self.namespaces[id] = namespace;
    }
    return self.namespaces[id];
}

const message_handlers = {
    'init': async event => {
        await init(event.data.options);
    },

    'loadPackages': async event => {
        await init();
        self.pyodide.loadPackage(event.data.packages);
    },

    'setInterruptBuffer': async event => {
        await init();
        self.pyodide.setInterruptBuffer(event.data.interruptBuffer);
    },

    'writeFile': async event => {
        await init();
        const {path, data} = event.data;
        self.pyodide.FS.writeFile(path, data);
    },

    'readFile': async event => {
        await init();
        const {path} = event.data;
        const encoding = encoding || 'utf8';
        const data = self.pyodide.FS.readFile(path, {encoding});
        self.postMessage({
            file_content: path,
            data
        });
    },

    'runPython': async event => {
        await init();
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
    }
};

self.onmessage = async (event) => {
    const {command} = event.data;
    console.log("Got message",command);
    
    const fn = message_handlers[command];
    if(!fn) {
        console.log("Pyodide runner: unrecognised message type",command);
    }

    fn(event);
};

