const pyodide_version = 'v0.24.1';
const pyodide_indexURL = `https://cdn.jsdelivr.net/pyodide/${pyodide_version}/full/`;
importScripts(pyodide_indexURL + 'pyodide.js');

self.stdout = [];
self.stderr = [];

self.pyodidePromise = null;

async function init(options) {
    if(!self.pyodidePromise) {

        const default_options = {
            indexURL: pyodide_indexURL,
            stdout: s => self.stdout.push(s),
            stderr: s => self.stderr.push(s)
        };
        const final_options = Object.assign(default_options, options);

        self.pyodidePromise = (async () => {
            const pyodide = await loadPyodide(final_options);
            self.pyodide = pyodide;

            const preamble = options.preamble || "import os; os.environ['MPLBACKEND'] = 'AGG'";
            self.pyodide.runPython(preamble);

            return self.pyodide;
        })();
    }
    return self.pyodidePromise;
}

async function preload(options) {
    await init();

    const {packages, files, context_id} = options;

    if(packages) {
        self.pyodide.loadPackage(packages);
    }

    if(files) {
        load_files(files, context_id);
    }
}

/**
 * So that separate questions don't see each other's resources, there is a system of contexts.
 * When preloading pyodide or running code, you can specify a `context_id` option, which specifies the context to use.
 * Each context has its own list of files.
 * If you don't give a `context_id`, the default context is used.
 * If you do give a `context_id`, the files available are those belonging to that context as well as those in the default context (for backwards compatibility with questions written before contexts were introduced).
 */

self.contexts = {};

function get_context(context_id) {
    context_id = context_id === undefined ? '' : context_id;
    if(self.contexts[context_id] === undefined) {
        self.contexts[context_id] = {
            files: []
        };
    }
    
    return self.contexts[context_id];
}

function use_context(context_id) {
    const default_context = get_context();
    const context = get_context(context_id);
    init_filesystem(default_context.files.concat(context.files));
}

/**
 * Load a file from the question resources, and return a blob which can be used in the worker's resources filesystem.
 *
 * @param {string} name
 * @returns {Object} ``name`` and ``data: Blob``.
 */
async function load_file(name) {
    const res = await fetch('../../../resources/question-resources/'+name);
    const blob = await res.blob();
    return {name, data: blob};
}

/**
 * Load a list of files from the question resources, and store them in the context with the given ID.
 */
async function load_files(filenames, context_id) {
    const context = get_context(context_id);

    await Promise.all(filenames.map(async name => {
        const file = await load_file(name);
        context.files.push(file);
    }));
}

self.fs_mounted = false;

/**
 * Initialise the filesystem mounted at `/resources` with the given list of files, represented as blobs.
 */
function init_filesystem(blobs) {
    const {FS} = self.pyodide;

    const path = '/resources';

    if(self.fs_mounted) {
        FS.unmount(path);
    } else {
        FS.mkdir(path);
    }
    FS.mount(FS.filesystems.WORKERFS, {
        blobs: blobs,
        files: [], 
    }, path);
    self.fs_mounted = true;
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

    'preload': async event => {
        await preload(event.data.options);
    },

    /** Kept for backwards compatibility.
     */
    'loadPackages': async event => {
        await preload({packages: event.data.options});
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
        const { job_id, code, namespace_id, context_id } = event.data;

        self.stdout = [];
        self.stderr = [];

        const namespace = await self.get_namespace(namespace_id);

        use_context(context_id);

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
    
    const fn = message_handlers[command];
    if(!fn) {
        console.log("Pyodide runner: unrecognised message type",command);
    }

    fn(event);
};

