/** 
 * Programming extension for Numbas
 * by Chris Graham and Christian Lawson-Perfect & George Stagg, Newcastle University, 2020-2022
 *
 */
Numbas.addExtension('programming', ['display', 'util', 'jme'], function(programming) {

    const remove_ansi_escapes = programming.remove_ansi_escapes = function(str) {
        return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,'');
    }

/////////////////////////// PREAMBLE

    var jme = Numbas.jme;
    var types = jme.types;
    var funcObj = jme.funcObj;
    var TString = types.TString;
    var TDict = types.TDict;
    var TNum = types.TNum;
    var TList = types.TList;
    var unwrap = jme.unwrapValue;
    var sig = Numbas.jme.signature;

    /** Load a remote script file.
     * @param {string} url
     * @returns {Element} - The <script> tag.
     */
    const load_script = programming.load_script = function(url) {
        var script = document.createElement('script');
        script.src = url;
        script.type = 'module';
        document.head.appendChild(script);
        return script;
    }

//////////////////////////// CODE EDITOR WIDGET

    Numbas.loadStandaloneScript('programming', 'ace/ace.js');

    /** A promise which resolves when ace.js has put the `ace` object into the global scope.
     */
    var acePromise = new Promise(function(resolve, reject) {
        var checkInterval = setInterval(function() {
            if(window.ace) {
                clearInterval(checkInterval);
                resolve(window.ace);
            }
        }, 100);
    });

    /** An ace code editor input widget for a part.
     *
     * @param {Element} element - The parent element of the widget.
     * @param {Numbas.parts.Part} part - The part whose answer the widget represents.
     * @param {string} title - The `title` attribute for the widget: a text description of what the widget represents.
     * @param {Object.<Function>} events - Callback functions for events triggered by the widget.
     * @param {Numbas.answer_widgets.answer_changed} answer_changed - A function to call when the entered answer changes.
     * @param {Object} options - Any options for the widget.
     */
    function CodeEditor(element, part, title, events, answer_changed, options) {
        var ce = this;
        this.part = part;
        this.title = title;
        this.events = events;
        this.answer_changed = answer_changed;
        this.options = options;

        this.editorPromise = acePromise.then(function(ace) {
            var editor = ace.edit(element);
            ce.editor = editor;

            var theme = options.theme || 'textmate';

            editor.setTheme("ace/theme/"+theme);
            editor.setShowPrintMargin(false);
            editor.setHighlightActiveLine(false);
            editor.setOptions({
                maxLines: Infinity,
                fontFamily: "monospace",
                fontSize: "12pt"
            });
            if(options.language) {
                editor.session.setMode("ace/mode/"+options.language);
            }
            editor.renderer.setScrollMargin(10, 10);

            editor.session.on('change', function(e) {
                if(ce.setting_value) {
                    return;
                }
                var code = editor.getValue();
                ce.answer_changed({valid: true, value: code});
            });

            if(ce.part) {
                editor.commands.addCommand({
                    name: 'submit',
                    bindKey: {win: 'Ctrl-Enter',  mac: 'Command-Enter'},
                    exec: function(editor) {
                        part.display.controls.submit(false);
                    },
                    readOnly: true // false if this command should not apply in readOnly mode
                });
            }

            if(ce.events) {
                for(var x in ce.events) {
                    editor.on(x, ce.events[x]);
                }
            }
            element.addEventListener('keyup', function(e) {
                e.stopPropagation();
            });
            element.addEventListener('keypress', function(e) {
                e.stopPropagation();
            });

            return editor;
        });
        this.editorPromise.then(function(editor) {
            if(options.placeholder && !ce.value_set) {
                ce.setAnswerJSON({valid: true, value: options.placeholder});
            }
        });
    };
    CodeEditor.prototype = {
        /** Is the editor currently setting its value?
         *  Avoids an infinite loop between the widget and the part.
         *  @type {boolean}
         */
        setting_value: false,

        /** Set the value of the widget based on an `answerJSON` object.
         * @param {custom_part_answer} answerJSON
         */
        setAnswerJSON: async function(answerJSON) {
            if(answerJSON.value === undefined) {
                return;
            }
            var ce = this;
            ce.value_set = true;
            ce.most_recent_answer = answerJSON;
            const editor = await this.editorPromise;
            if(answerJSON !== ce.most_recent_answer) {
                return;
            }
            ce.setting_value = true;
            var code = answerJSON.value;
            if(code === undefined) {
                code = '';
            }
            if(code != editor.getValue()) {
                editor.setValue(code);
                editor.clearSelection();
            }
            ce.setting_value = false;
        },

        /** Disable the widget - make it read-only.
         */
        disable: async function() {
            const editor = await this.editorPromise;
            editor.setReadOnly(true);
            editor.renderer.$cursorLayer.element.style.display = 'none';
        },

        /** Enable the widget - allow editing.
         */
        enable: async function() {
            const editor = await this.editorPromise;
            editor.setReadOnly(false);
            editor.renderer.$cursorLayer.element.style.display = 'block';
        }
    }

    Numbas.answer_widgets.register_custom_widget({
        name: 'code-editor', 
        niceName: 'Code editor',
        widget: CodeEditor, 
        signature: 'string', 
        answer_to_jme: function(answer) {
            return new TString(answer);
        },
        options_definition: [
            {
                name: 'language',
                label: 'Code language',
                input_type: 'dropdown',
                data: {
                    choices: [
                        {value: 'python', label: 'Python'},
                        {value: 'javascript', label: 'JavaScript'},
                        {value: 'r', label: 'R'}
                    ]
                },
                default_value: 'python'
            },
            {
                name: 'placeholder',
                label: 'Placeholder',
                input_type: 'code',
                default_value: ''
            },
            {
                name: 'theme',
                label: 'Editor theme',
                input_type: 'string',
                default_value: 'textmate'
            }
        ],
        scorm_storage: {
            interaction_type: function(part) { return 'fill-in'; },
            correct_answer: function(part) { return part.input_options().correctAnswer; },
            student_answer: function(part) { return part.studentAnswer; },
            load: function(part, data) { return data.answer; }
        }
    });

    /** Options for `render_code_block`.
     *
     * @typedef {Numbas.extensions.programming.render_code_block_options}
     * @property {string} language - The language to use for syntax highlighting.
     * @property {boolean} gutter - Show the gutter? (default: `false`)
     * @property {string} theme - The theme to use? (default: `ace/theme/textmate`)
     */

    /** Produce a read-only ACE code editor containing the given code.
     * @param {string} code - The code to display.
     * @param {Numbas.extensions.programming.render_code_block_options} options
     * @returns {Element}
     */
    var render_code_block = programming.render_code_block = function(code, options) {
        if(typeof options=='string') {
            options = {language: options};
        }
        options = options || {};
        var element = document.createElement('div');
        element.classList.add('ace-editor-container');

        acePromise.then(function(ace) {
            var div = document.createElement('div');
            div.classList.add('acediv');
            element.appendChild(div);
            var editor = ace.edit(div);
            editor.setValue(code);
            editor.clearSelection();
            editor.setTheme(options.theme || "ace/theme/textmate");
            if(options.language) {
                editor.session.setMode("ace/mode/"+options.language);
            }
            editor.setShowPrintMargin(false);
            editor.setHighlightActiveLine(false);
            editor.setReadOnly(true);
            editor.setOptions({
                maxLines: Infinity
            });
            editor.renderer.setShowGutter(options.gutter);
            editor.setOptions({
                fontFamily: "monospace",
                fontSize: "12pt"
            });
            editor.renderer.setScrollMargin(10, 10);
            editor.renderer.$cursorLayer.element.style.display = "none";
            return editor;
        })

        return element;
    };


//////////////////////////// CODE RUNNERS


    /** Objects to run code in different languages.
     * @enum {CodeRunner}
     */
    var language_runners = programming.language_runners = {}

    const register_language_runner = programming.register_language_runner = function(name, runner) {
        language_runners[name] = new runner();
    }

    /** An object which can run code in a certain language.
     */
    class CodeRunner {

        constructor() {
            this.queue = Promise.resolve();
            this.job_id_acc = 0;
            this.jobs = {};

            this.namespace_id_acc = 0;
            this.clear_buffers();
        }

        /** Preload the files necessary to run code in this language, and optionally install a list of packages and make files available from the question resources.
         *
         * @param {Numbas.extensions.programming.preload_options} options
         */
        async preload(options) {
        }

        /** Clear the STDOUT and STDERR buffers.
         */
        clear_buffers() {
            this.buffers = {
                stdout: '',
                stderr: ''
            };
        }

        /** The contents of the STDOUT buffer after running a block of code.
         * @type {string}
         */
        get stdout() {
            return this.buffers.stdout;
        }

        /** The contents of the STDERR buffer after running a block of code.
         * @type {string}
         */
        get stderr() {
            return this.buffers.stderr;
        }

        /** Create a session using this runner.
         *
         * @param {string} [context_id] - The ID of the context in which to run the code.
         * @returns {Numbas.extensions.programming.CodeSession}
         */
        new_session(context_id) {
            return new CodeSession(this, context_id);
        }

        /** Create a new namespace to run code in.
         * @returns {namespace_id}
         */
        new_namespace() {
            return this.namespace_id_acc++;
        }

        /** Create a new ID for a job.
         * @returns {Numbas.extensions.programming.job}
         */
        new_job() {
            const job_id = this.job_id_acc++;
            const promise = new Promise((resolve, reject) => {
                this.jobs[job_id] = { id: job_id, resolve, reject };
            });
            const job = this.jobs[job_id];
            job.promise = promise;
            return job;
        }

        /** Get the job with the given ID, or throw an error if it doesn't exist.
         * @param {job_id} job_id
         * @returns {Numbas.extensions.programming.job}
         */
        get_job(job_id) {
            if(!this.jobs[job_id]) {
                throw(new Error("Unrecognised job id "+job_id));
            }
            return this.jobs[job_id];
        }

        /** Queue tasks: the given callback function is called only after everything else in the queue, and subsequent queued tasks only run after this one has resolved.
         * @param {Function} fn - Must return a Promise.
         * @returns {Promise}
         */
        async enqueue(fn) {
            this.queue = this.queue.then(() => {
                const qr = fn();
                return qr;
            });
            const r = await this.queue;
            return r;
        }

        /** Run some code in this runner, in the given namespace.
         * @param {string} code - The code to run.
         * @param {CodeSession} session - The session to run the code in.
         * @returns {Numbas.extensions.programming.job}
         */
        run_code(code, session) {
            throw(new Error("run_code should be implemented."));
        }

        /** Interrupt the execution of a job.
         * @param {job_id} job_id
         */
        interrupt() {
            throw(new Error("This code runner can't be interrupted."));
        }

        /** Run several blocks of code in the same session.
         *  Empty blocks of code won't run, but will return result `undefined` and success `true`.
         *
         * @param {Array.<string>} codes - Blocks of code to run.
         * @param {string} [context_id] - The ID of the context in which to run the code.
         * @returns {Promise.<Array.<Numbas.extensions.programming.run_result>>}
         */
        async run_code_blocks(codes, context_id) {
            const session = this.new_session(context_id);
            var results = [];
            for(let code of codes) {
                if(code.trim()=='') {
                  results.push({
                    result: undefined,
                    success: true,
                    stdout: '',
                    stderr: ''
                  });
                  continue;
                }
                try {
                    const result = await session.run_code(code);
                    results.push(result);
                } catch(error) {
                    results.push(error);
                }
            }

            return results;
        }
    }
    programming.CodeRunner = CodeRunner;

    /** 
     * An independent session to run code in.
     * Code run in one session should not affect code run in another.
     * @param {Numbas.extensions.programming.CodeRunner} runner
     * @param {string} [context_id] - The ID of the context in which to run the code.
     */
    class CodeSession {
        constructor(runner, context_id) {
            this.runner = runner;
            this.namespace_id = runner.new_namespace();
            this.context_id = context_id;
        }

        async run_code(code) {
            try {
                const job = await this.runner.run_code(code, this);
                const result = await job.promise;
                return Object.assign({success: true}, result);
            } catch(err) {
                return Object.assign({success: false}, err);
            }
        }
    }
    programming.CodeSession = CodeSession;

    /** Load pyodide - inserts the script in the page, and returns a promise which resolves to the `pyodide` object. 
     * @returns {Promise.<pyodide>}
     */
    class PyodideRunner extends CodeRunner {
        constructor() {
            super();
        }

        load_pyodide(options) {
            options = options || {};
            if(!this.pyodidePromise) {
                this.pyodidePromise = new Promise((resolve, reject) => {
                    const worker_url = Numbas.getStandaloneFileURL('programming', 'pyodide_worker.js');
                    var worker = this.worker = new Worker(worker_url);

                    /* // Needs a cross-origin isolated context, which I can't work out how to achieve.
                    this.interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
                    worker.postMessage({
                        command: "setInterruptBuffer",
                        interruptBuffer: this.interruptBuffer 
                    });
                    */
                    worker.postMessage({
                        command: 'init',
                        options
                    });

                    worker.onmessage = (event) => {
                        const job_id = event.data.job_id;
                        const job = this.get_job(job_id);
                        if(event.data.error) {
                            if(event.data.error_name == 'ConversionError') {
                                job.resolve({
                                    result: null,
                                    job_id,
                                    stdout: event.data.stdout,
                                    stderr: event.data.stderr
                                });
                            }
                            job.reject(event.data);
                        } else {
                            job.resolve(event.data);
                        }
                    }

                    resolve(worker);
                });
            }

            this.pyodidePromise.then(worker => {
                worker.postMessage({
                    command: 'preload',
                    options
                });
            });
            return this.pyodidePromise;
        }

        async preload(options) {
            const worker = await this.load_pyodide(options);
            return worker;
        }

        run_code(code, session) {
            const job = this.new_job();
            this.load_pyodide().then(worker => {
                worker.postMessage({
                    command: 'runPython',
                    job_id: job.id,
                    namespace_id: session.namespace_id,
                    context_id: session.context_id,
                    code: code
                });
            });
            return job;
        }

        interrupt(job_id) {
            if(this.interruptBuffer) {
               this.interruptBuffer[0] = 2;
            } else {
                return super.interrupt(job_id);
            }
        }
    }
    programming.PyodideRunner = PyodideRunner;

    register_language_runner('pyodide', PyodideRunner);

    /** Load webR - inserts the script in the page, and returns a promise which resolves to the `webR` object. 
     * @returns {Promise.<webR>}
     */
    class WebRRunner extends CodeRunner {
        constructor() {
            super();
            this.contexts = {}

            this.fs_mounted = false;
        }

        get_context(context_id) {
            context_id = context_id === undefined ? '' : context_id;
            if(this.contexts[context_id] === undefined) {
                this.contexts[context_id] = {
                    files: []
                };
            }
            
            return this.contexts[context_id];
        }

        async use_context(context_id) {
            const default_context = this.get_context();
            const context = this.get_context(context_id);
            let files = default_context.files;
            if(context != default_context) {
                files = files.concat(context.files);
            }
            await this.init_filesystem(files);
        }

        async init_filesystem(blobs) {
            const webR = await this.load_webR();

            const {FS} = webR;

            const path = '/resources';

            if(this.fs_mounted) {
                await FS.unmount(path);
            } else {
                await FS.mkdir(path);
            }

            await FS.mount("WORKERFS", {
                blobs,
                files: [],
            }, path);
            
            this.fs_mounted = true;
        }

        async new_session(context_id) {
            const session = await super.new_session(context_id);

            const webR = await this.load_webR();

            session.shelter = await new webR.Shelter();
            session.env = await new webR.REnvironment();
            session.files = [];

            return session;
        }

        /** Start loading webR.
         * @returns {Promise} - Resolves to the `webR` object once it has loaded.
         */
        load_webR() {
            if(!this.webRPromise) {
                load_script(Numbas.getStandaloneFileURL('programming', 'webr.js'));

                this.webRPromise = new Promise((resolve, reject) => {
                    var checkInterval = setInterval(async () => {
                        if(window.WebR) {
                            window.parent.WebR = WebR;
                            clearInterval(checkInterval);
                            const webR = new WebR.WebR();
                            await webR.init();
                            await webR.evalRVoid('webr::shim_install()');
                            resolve(webR);
                        }
                    }, 50);
                });
            }
            return this.webRPromise;
        }

        async preload(options) {
            const webR = await this.load_webR();

            const {packages, files} = options;

            if(packages !== undefined) {
                await webR.installPackages(packages);
            }

            if(files !== undefined) {
                const context = this.get_context(options.context_id);
                await Promise.all(files.map(async (name) => {
                    const res = await fetch('resources/question-resources/'+name);
                    const blob = await res.blob();
                    context.files.push({name, data: blob});
                }));
            }

            return webR;
        }

        async r_to_js(obj) {
            switch(await obj.type()) {
                case "list":
                    return new types.TList(obj.toArray().map(x => this.r_to_js(x)));

                default:
                    try {
                        let value = await obj.toArray();
                        if(value.length == 1) {
                            value = value[0];
                        }
                        return value;
                    } catch(e) {
                        return null;
                    }
            }
        }

        run_code(code, session) {
            if(session !== undefined) {
                code = code.replace(/\r\n?/g,'\n');
            }

            return this.enqueue(async () => {
                const job = this.new_job();

                const webR = await this.load_webR();
                const shelter = session ? await session.shelter : webR.globalShelter;

                await this.use_context(session.context_id);

                if(session.last_value !== undefined) {
                    await session.env.bind('.Last.value', session.last_value);
                }

                let res, res2;

                try {

                    const options = { env: session.env, withAutoprint: true, captureGraphics: false };
                    res = await shelter.captureR(code, options);
                    res2 = await shelter.captureR("cat('\n')", options);

                } catch(e) {
                    console.error(e);
                    let message = e.message;
                    const m = message.match(/^<text>:(\d+?):(\d+?): ([\s\S]*)/m);
                    if(m) {
                        message = `Error on line ${m[1]} character ${m[2]}:\n${m[3]}`;
                    }
                    res = {
                        result: null,
                        output: [{type:'stderr', data: message}],
                        images: []
                    };

                } finally {
                    let {output, result, images} = res;
                    if(res2) {
                        output = output.concat(res2.output);
                    }

                    /* The following block looks for any Canvas images captured by webR, and converts
                     * them to data URLs that can be inserted in HTML feedback.
                     * At the moment the code is evaluated with `captureGraphics: false`, so no images
                     * will be captured by webR. If we sort out how to get SVG and canvas images working
                     * together, this code would be useful.
                     */
                    images = await Promise.all(images.map(async image => {
                        const ocanvas = new OffscreenCanvas(image.width, image.height);
                        const ctx = ocanvas.getContext('2d');
                        ctx.drawImage(image,0,0);
                        const blob = await ocanvas.toBlob();
                        const url = URL.createObjectURL(blob);
                        return `<img src="${url}">`;
                    }));

                    session.last_value = result;

                    let js_result = null;
                    try {
                        js_result = result ? await this.r_to_js(result) : null;
                    } catch(e) {
                    }

                    const stdout = output.filter(({type, data}) => type=='stdout').map(msg => msg.data).join('\n');
                    const stderr = output.filter(({type}) => type=='stderr').map(msg => msg.data).join('\n');

                    const homedir = '/home/web_user';
                    for(let f of Object.values((await webR.FS.lookupPath(homedir)).contents)) {
                        if(f.name.match(/^Rplot.*\.svg$/) && !f.isFolder) {
                            const path = `${homedir}/${f.name}`;
                            const data = await webR.FS.readFile(path);
                            const blob = new Blob([data], {type: 'image/svg+xml'});
                            const text = await blob.text();
                            if(text) {
                                images.push(text);
                                await webR.FS.unlink(path);
                            }
                        }
                    }

                    const out = {
                        result: js_result,
                        stdout,
                        stderr,
                        images
                    };
                    if(stderr.length) {
                        job.reject(out);
                    } else {
                        job.resolve(out);
                    }
                }
                return job;
            });
        }

        /** Run several blocks of code in the same session.
         *  Empty blocks of code won't run, but will return result `undefined` and success `true`.
         *
         * @param {Array.<string>} codes - Blocks of code to run.
         * @param {string} [context_id] - The ID of the context in which to run the code.
         * @returns {Promise.<Array.<Numbas.extensions.programming.run_result>>}
         */
        async run_code_blocks(codes, context_id) {
            const session = await this.new_session(context_id);
            const results = await Promise.all(codes.map(async (code) => {
                if(code.trim()=='') {
                    return {
                        result: undefined,
                        success: true,
                        stdout: '',
                        stderr: ''
                    }
                }
                try {
                    const result = await session.run_code(code);
                    return result;
                } catch(error) {
                    return error;
                }
            }));
            const webR = await this.load_webR();
            const shelter = await session.shelter;
            await shelter.purge();
            await webR.globalShelter.purge();
            return results;
        }
    }
    programming.WebRRunner = WebRRunner;

    register_language_runner('webr', WebRRunner);

    /** Results produced by `run_code`.
     *
     * @typedef {Numbas.extensions.programming.run_code_result}
     * @property {string} result - The value produced by the program.
     * @property {number} success - Did the code run without errors?
     * @property {string} stdout - The contents of the program's STDOUT buffer.
     * @property {string} stderr - The contents of the program's STDERR buffer.
     */


    /** Run some blocks of code.
     *  The blocks are run one after the other, in the same session - sharing the same global scope.
     *
     * @param {string} language - The language of the code to run.
     * @param {Array.<string>} codes - Blocks of code to run. 
     * @param {string} [context_id] - The ID of the context in which to run the code.
     * @returns {Promise.<Array.<Numbas.extensions.programming.run_result>>}
     */
    var run_code = programming.run_code = async function(language, codes, context_id) {
        try {
            return await language_runners[language].run_code_blocks(codes, context_id);
        } catch(error_results) {
            return codes.map(() => { 
                return {
                    error: error_results.message,
                }
            });
        }
    }

    /** Options for `preload`.
     *
     * @typedef {Numbas.extensions.programming.preload_options}
     * @property {Array.<string>} packages - Names of packages to load.
     * @property {Array.<string>} files - Names of files to load from the question resources, and make available under the path `/resources`.
     */

    /** Preload the given language, and load the given list of packages.
     *
     * @param {string} language - The name of the language runner to preload.
     * @param {Numbas.extensions.programming.preload_options|Array.<string>} options - Either an object of options, or just a list of names of packages to load.
     */
    var preload = programming.preload = function(language, options) {
        if(Array.isArray(options)) {
            options = {
                packages: options
            };
        }
        return language_runners[language].preload(options || {});
    };

//////////////////////////// SERIALIZE JME TO OTHER LANGUAGES


    /** Synonyms for code languages (for when there's more than one way of running a given language)
     */
    var languageSynonyms = programming.languageSynonyms = {
        'pyodide': 'python',
        'webr': 'r'
    }

    /** Get the canonical name for a language by applying synonyms.
     * @param {string} name
     * @returns {string}
     */
    var language_synonym = programming.language_synonym = function(name) {
        return languageSynonyms[name] || name;
    }

    /** Dictionaries of functions to render JME tokens in target languages.
     */
    var wrapTypes = programming.wrapTypes = {};

    programming.wrapTypes.python = {
        'number': function(tok) {
            return Numbas.math.niceNumber(tok.value);
        },
        'string': function(tok) {
            return '"'+jme.escape(tok.value)+'"';
        },
        'boolean': function(tok) {
            return tok.value ? 'True' : 'False';
        },
        'range': function(tok) {
            return 'range('+tok.value[0]+', '+tok.value[1]+', '+tok.value[2]+')';
        },
        'list': function(tok) {
            return '['+tok.value.map(wrapPython).join(', ')+']';
        },
        'dict': function(tok) {
            var items = [];
            for(var x in tok.value) {
                items.push('"'+jme.escape(x)+'": '+wrapPython(tok.value[x]));
            }
            return '{' + items.join(', ') + '}';
        },
        'set': function(tok) {
            return '{'+tok.value.map(wrapPython)+'}';
        },
        'nothing': function(tok) {
            return 'None';
        }
    }

    programming.wrapTypes.r = {
        'number': function(tok) {
            return Numbas.math.niceNumber(tok.value);
        },
        'string': function(tok) {
            return '"'+jme.escape(tok.value)+'"';
        },
        'boolean': function(tok) {
            return tok.value ? 'TRUE' : 'FALSE';
        },
        'list': function(tok) {
            return 'c('+tok.value.map(wrapPython).join(', ')+')';
        },
        'set': function(tok) {
            return 'c('+tok.value.map(wrapPython).join(', ')+')';
        }
    }

    /** Functions to produce a line of code which assigns an expression to a name.
     */
    var assignExpr = programming.assignExpr = {
        'python': function(name, expr) {
            return name+' = '+expr;
        },
        'r': function(name, expr) {
            return name+' <- '+expr;
        }
    }

    /** Produce a line of code which assigns the given expression to the given name.
     * @param {string} language
     * @returns {Function.<string, string>}
     */
    var assignVariable = programming.assignVariable = function(language) {
        language = language_synonym(language);
        return function(name, token) {
            var expr = wrapToken(language, token);
            return assignExpr[language](name, expr);
        }
    }

    /** Render a JME token in the given target language.
     * @param {string} language
     * @returns {Function.<Numbas.jme.token>}
     */
    var wrapToken = programming.wrapToken = function(language) {
        language = language_synonym(language);
        var types = wrapTypes[language];
        return function(token) {
            var wrapper = types[token.type];
            if(!wrapper) {
                for(var x in types) {
                    if(jme.isType(token, x)) {
                        token = jme.castToType(token, x);
                        wrapper = types[x];
                        break;
                    }
                }
                if(!wrapper) {
                    throw(new Numbas.Error("Can't render a token of type "+token.type+" in "+language));
                }
            }
            return wrapper(token);
        }
    }

    var wrapPython = programming.wrapPython = wrapToken('python');
    var wrapR = programming.wrapR = wrapToken('r');

//////////////////////////// JME FUNCTIONS


    /** Render some Numbas variables as assignment expressions in the target language.
     */
    programming.scope.addFunction(new funcObj('variables_as_code', [TString, TDict], TString, function(language, variables) {
        var vars = [];
        Object.entries(variables).forEach(function(e) {
            var name = e[0];
            var value = e[1];
            vars.push(name+' = '+wrapToken(language)(value));
        });
        return vars.join('\n');
    }));
  
    /** Return the synonym for given code language
     */
    programming.scope.addFunction(new funcObj('language_synonym', [TString], TString, function(language) {
        return language_synonym(language);
    }));

    /** Start a pre-submit task to mark some code against some unit tests.
     */
    programming.scope.addFunction(new funcObj('run_code', ['string', 'list of string', sig.optional(sig.type('string'))], types.TPromise, null, {
        evaluate: function(args, scope) {
            var language = args[0].value;
            var codes = args[1];
            var context_id = args[2].value || (scope.question ? scope.question.number : undefined);
            return new types.TPromise(run_code(language, jme.unwrapValue(codes), context_id).then(function(result) {
                return {code_result: jme.wrapValue(result)};
            }));
        }
    }));

    /** Render a static code block.
     */
    programming.scope.addFunction(new funcObj('code_block', [TString, '[dict or string]'], types.THTML, null, {
        evaluate: function(args, scope) {
            var code = jme.unwrapValue(args[0]);
            var options = jme.unwrapValue(args[1]);
            return new types.THTML(render_code_block(code, options));
        }
    }));


    function add_jme_marking_test(test_name, fn, args) {
        args = (args || [TString]).slice();
        args.push(TNum);
        programming.scope.addFunction(new funcObj(test_name, args, TList, null, {
            evaluate: function(args,scope) {
                const [desc, code] = fn(args.slice(0,args.length-1).map(arg=>Numbas.jme.unwrapValue(arg)));
                const weight = args[args.length-1].value;
                return Numbas.jme.wrapValue([desc, weight, code]);
            }
        }));
    }

    function add_jme_validation_test(test_name, fn, args) {
        args = (args || [TString]).slice();
        programming.scope.addFunction(new funcObj(test_name, args, TList, null, {
            evaluate: function(args,scope) {
                const [desc, code] = fn(...args.map(arg => Numbas.jme.unwrapValue(arg)));
                return Numbas.jme.wrapValue([desc, code]);
            }
        }));
    }

    programming.scope.addFunction(new funcObj('py_mark_equal', [TString, '?', sig.optional(sig.type('number'))], [TList], null, {
        evaluate: function(args,scope) {
            var name = args[0].value;
            var value = wrapToken('python')(args[1]);
            var weight = args[2].type=='nothing' ? 1 : args[2].value;
            return Numbas.jme.wrapValue([`${name} == ${value}`, weight, `${name} == ${value}`]);
        }
    }));

    add_jme_validation_test('py_valid_defined', name => [`${name} is defined`, `'${name}' in locals()`]);
    add_jme_validation_test('py_valid_callable', name => [`${name} is a function`, `'${name}' in locals() and callable(${name})`]);
    add_jme_validation_test('py_valid_isinstance', (name,type) => [`${name} has type ${type}`, `'${name}' in locals() and isinstance(${name},${type})`], [TString, TString]);

    programming.mime_types = {
      '.pdf': 'application/pdf',
      '.svg': 'image/svg+xml'
    }

    programming.scope.addFunction(new funcObj('r_load_files', ['string or (list of string)'], types.TPromise, null, {
        evaluate: function(args,scope) {
            var filenames;
            if(args[0].type=='string') {
                filenames = [args[0].value];
            } else {
                filenames = Numbas.jme.unwrapValue(args[0]);
            }
            return new types.TPromise(programming.language_runners['webr'].load_webR().then(async (webR) => {
                var promises = [];
                filenames.forEach(filename => {
                    promises.push(new Promise((resolve,reject) => {
                        setTimeout(async function() {
                            try {
                                const buf = await webR.FS.readFile(filename);
                                const extension = filename.match(/\.[^.]*$/)[0];
                                const mime_type = mime_types[extension] || 'text/plain';
                                var blob = new Blob([buf], {type: mime_type});
                                if(mime_type == 'text/plain' || mime_type == 'image/svg+xml') {
                                    const text = await blob.text();
                                    resolve({exists: true, text: text, mime_type});
                                } else {
                                    resolve({exists: true, blob: URL.createObjectURL(blob), mime_type});
                                }
                            } catch(err) {
                                resolve({exists: false, error: err.message});
                            }
                        },10);
                    }));
                });
                const results = await Promise.all(promises);
                var o = {};
                results.forEach((value,i) => { o[filenames[i]] = jme.wrapValue(value); });
                return {
                    r_files: new Numbas.jme.types.TDict(o)
                }
            }));
        }
    }));
});
