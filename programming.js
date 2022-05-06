/** 
 * Programming extension for Numbas
 * by Chris Graham and Christian Lawson-Perfect & George Stagg, Newcastle University, 2020-2022
 *
 */
Numbas.addExtension('programming', ['display', 'util', 'jme'], function(programming) {

/////////////////////////// PREAMBLE

    programming.webR_url = 'https://cdn.jsdelivr.net/gh/georgestagg/webR@452ae1637dfdd65c9a5f462fff439022d833f8f9/dist/';

    var jme = Numbas.jme;
    var types = jme.types;
    var funcObj = jme.funcObj;
    var TString = types.TString;
    var TDict = types.TDict;
    var TNum = types.TNum;
    var TList = types.TList;
    var unwrap = jme.unwrapValue;
    var marking = Numbas.marking;
    var feedback = marking.feedback;
    var sig = Numbas.jme.signature;

    /** Load a remote script file.
     * @param {string} url
     * @returns {Element} - The <script> tag.
     */
    const load_script = programming.load_script = function(url) {
        var script = document.createElement('script');
        script.setAttribute('src', url);
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
                        part.submit();
                    },
                    readOnly: true // false if this command should not apply in readOnly mode
                });
            }

            if(ce.events) {
                for(var x in ce.events) {
                    editor.on(x, ce.events[x]);
                }
            }
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
            const editor = await this.editorPromise;
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
            this.job_id_acc = 0;
            this.jobs = {};

            this.namespace_id_acc = 0;
            this.clear_buffers();
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
         * @returns {Numbas.extensions.programming.CodeSession}
         */
        new_session() {
            return new CodeSession(this);
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

        /** Get a promise that resolves once all jobs have fully resolved.
         * @returns {Promise}
         */
        get_queue() {
            const job_promises = Object.entries(this.jobs).map(([k,job]) => job.promise);
            return Promise.all(job_promises);
        }

        /** Run some code in this runner, in the given namespace.
         * @param {string} code - The code to run.
         * @param {namespace_id} namespace_id - The ID of the namespace to run the code in.
         * @returns {Numbas.extensions.programming.job}
         */
        run_code(code, namespace_id) {
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
         * @returns {Promise.<Array.<Numbas.extensions.programming.run_result>>}
         */
        async run_code_blocks(codes) {
            const session = this.new_session();
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

    /** An independent session to run code in.
     *  Code run in one session should not affect code run in another.
     *  @param {Numbas.extensions.programming.CodeRunner} runner
     */
    class CodeSession {
        constructor(runner) {
            this.runner = runner;
            this.namespace_id = runner.new_namespace();
        }

        async run_code(code) {
            try {
                const job = await this.runner.run_code(code, this.namespace_id);
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
            var worker = this.worker = new Worker(Numbas.getStandaloneFileURL('programming', 'pyodide_worker.js'));

            /* // Needs a cross-origin isolated context, which I can't work out how to achieve.
            this.interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
            worker.postMessage({
                command: "setInterruptBuffer",
                interruptBuffer: this.interruptBuffer 
            });
            */

            worker.onmessage = (event) => {
                const job_id = event.data.job_id;
                const job = this.get_job(job_id);
                if(event.data.error) {
                    job.reject(event.data);
                } else {
                    job.resolve(event.data);
                }
            }
        }
        run_code(code, namespace_id) {
            const queue = this.get_queue();
            const job = this.new_job();
            queue.then( _ => {
                this.worker.postMessage({
                    command: 'runPython',
                    job_id: job.id,
                    namespace_id: namespace_id,
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
        }

        new_session() {
            const session = super.new_session();
            this.run_code(`${this.namespace_name(session.namespace_id)} <- new.env()`);
            return session;
        }

        namespace_name(namespace_id) {
            return `webr_namespace${namespace_id}`;
        }

        /** Clear the STDOUT and STDERR buffers.
         */
        clear_buffers() {
            this.buffers = {
                stdout: [],
                stderr: []
            };
        }

        /** Start loading webR.
         * @returns {Promise} - Resolves to the `webR` object once it has loaded.
         */
        load_webR() {
            if(!this.webRPromise) {
                load_script(programming.webR_url + 'webR.js');

                this.webRPromise = new Promise((resolve, reject) => {
                    var checkInterval = setInterval(async () => {
                        if(window.loadWebR) {
                            clearInterval(checkInterval);
                            const webR = await loadWebR({
                                WEBR_URL: programming.webR_url,
                                loadPackages: [],
                                stdout: (s) => { 
                                    this.buffers.stdout.push(s); 
                                }, 
                                stderr: (s) => { 
                                    this.buffers.stderr.push(s); 
                                }
                            });
                            resolve(webR);
                        }
                    }, 50);
                });
            }
            return this.webRPromise;
        }

        /** Get the contents of the last line of STDOUT, or '' if STDOUT is empty.
         * @returns {string}
         */
        last_stdout_line() {
            return this.buffers.stdout.length == 0 ? '' : this.buffers.stdout[this.buffers.stdout.length-1];
        }

        get stdout() {
            return this.buffers.stdout.join('\n');
        }

        get stderr() {
            return this.buffers.stderr.join('\n');
        }

        run_code(code, namespace_id) {
            const queue = this.get_queue();
            const job = this.new_job();
            queue.then( _ => {
                this.clear_buffers();

                if(namespace_id !== undefined) {
                    code = `with(${this.namespace_name(namespace_id)}, {\n${code}\n})`;
                }

                this.load_webR().then(async (webR) => {
                    try {
                        const result = await webR.runRAsync(code);
                        if(result===-1) {
                            throw(new Error("Error running R code"));
                        } else {
                            job.resolve({
                                result: this.last_stdout_line() === "[1] TRUE",
                                stdout: this.stdout,
                                stderr: this.stderr,
                            });
                        }
                    } catch(err) {
                        this.buffers.stderr.push(err);
                        job.reject({
                            error: err.message,
                            stdout: this.stdout,
                            stderr: this.stderr
                        });
                    };
                });
            });

            return job;
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
     * @property {string} language - The language of the code to run.
     * @property {Array.<string>} codes - Blocks of code to run. 
     * @returns {Promise.<Array.<Numbas.extensions.programming.run_result>>}
     */
    var run_code = programming.run_code = async function(language, codes) {
        try {
            return await language_runners[language].run_code_blocks(codes);
        } catch(error_results) {
            return error_results;
        }
    }


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
    programming.scope.addFunction(new funcObj('run_code', ['string', 'list of string'], types.TPromise, null, {
        evaluate: function(args, scope) {
            var language = args[0].value;
            var codes = args[1];
            return new types.TPromise(run_code(language, jme.unwrapValue(codes)).then(function(result) {
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
                files.forEach(filename => {
                    promises.push(new Promise((resolve,reject) => {
                        setTimeout(async function() {
                            try {
                                const buf = await webR.getFileData(filename);
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
                results.forEach((value,i) => { o[files[i]] = jme.wrapValue(value); });
                return {
                    r_files: new Numbas.jme.types.TDict(o)
                }
            }));
        }
    }));
});
