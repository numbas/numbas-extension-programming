# Programming extension for Numbas

This extension adds a code editor input method, and the ability to run code.

There is built-in support for running:

* Python code in [Pyodide](https://pyodide.org/).
* R code in [webR](https://github.com/georgestagg/webR/)

There is a custom part type in `code.npt`, which marks code entered by the student by evaluating unit tests.

## Running code

The extension provides a JME function `run_code`.
Because the code might take a long time to run, it runs asynchronously; the function returns a `promise` value.

In order to use the results in marking, call `run_code` from the part's `pre_submit` note.
The rest of the marking algorithm will run once the code has finished running.

Here's an example:

```
pre_submit: 
    [
        run_code(
            "pyodide", 
            [
                studentAnswer,
                "'x' in locals()",
                "x==1"
            ]
        )
    ]
```

## Pre-loading a language

If the scripts for a language have not already been loaded when you try to run some code, then they are loaded automatically.
However, this can take a long time, depending on the speed of the student's internet connection.

You can pre-load a language with the function `Numbas.extensions.programming.preload(language, packages)`. The list of packages to load is optional.

For example, if your question will use R with the packages `ggplot2` and `dplyr`, put this line in your question's JavaScript preamble:

```
Numbas.extensions.programming.preload('webr', ['ggplot2', 'dply']);
```

The necessary files will start loading as soon as part of the exam loading process, so will usually be ready to use by the time the student submits some code.

## The code editor input method

The extension provides the [Ace editor](https://ace.c9.io/) as an input method for custom part types.
It has three options:

* **Code language** - The language to use for syntax highlighting.
* **Placeholder** - The initial content of the editor.
* **Editor theme** - The Ace theme to use. Only `textmate` is bundled with the extension.

## JME functions

### `run_code(language,codes)`

* `language` is a string containing the name of the code runner to use. The available code runners are `"pyodide"`, for Python, and `"webr"`, for R.
* `codes` is a list of strings of code.

Run some blocks of code and return the results in a `promise`.

The blocks are run one after the other, in the same global scope, so variables assigned in one block are available in subsequent blocks.

When run in the `pre_submit` note, this task adds an entry `code_result`, a list containing the results of each of the code blocks.
The result of a code block is represented in a dictionary of the following form:

* `result` - The final value produced by the block.
* `success` - `true` if the code ran without errors, otherwise `false`.
* `stdout` - The contents of the program's `STDOUT` buffer. This typically contains any text printed by the program.
* `stderr` - The contents of the program's `STDERR` buffer. This typically contains any error messages produced by the program.
* `error` - If the code threw an error, the text of the error.

### `variables_as_code(language, variables)`

Produce a block of code which assigns a series of variables in the given language.
The `variables` argument is a dictionary mapping variable names to values.

### `code_block(code,options)`

Display some code in a syntax-highlighted code area.

The `options` argument is an optional dictionary of options, or just the name of the language to use for syntax highlighting.
The following options can be set:

* `language` - The language to use for syntax highlighting.
* `theme` - The Ace theme to use. Only the `textmate` theme is built in to this extension.
* `gutter` - Show or hide the gutter, which shows line numbers.

### `language_synonym(runner)`

Return the name of the language corresponding to the given runner.

`"pyodide"` returns `"python"`; `"webr"` returns `"r"`.

### Marking functions

There are a few functions to produce common marking tests:

* `py_mark_equal(name,value,[weight=1])` - Checks that the variable with the given name has the given value. The name should be a string, but the value can be any JME value. Example: `py_mark_equal('x', 1)`

### Validation functions

There are a few functions to produce common validation tests:

* `py_valid_defined(name)` - Checks that a variable with the given name has been defined - equivalent to `'name' in locals()`.
* `py_valid_callable(name)` - Checks that the object with the given name has been defined and is callable - equivalent to `'name' in locals() and callable(name)`. 
* `py_valid_isinstance(name,type)` - Checks that the object with the given name has been defined and is an instance of the given type - equivalent to `'name' in locals() and isinstance(name, type)`.

## Adding another language

The class `Numbas.extensions.programming.CodeRunner` contains methods for running code in a particular language.
To add a new language, define a new class extending this one, implementing the `run_code` method.

Then call `Numbas.extensions.programming.register_language_runner(name, runner)` with the name of the runner and the class.
Only one instance of the class will ever be created.

See the `PyodideRunner` and `WebRRunner` classes in this extension for examples of how to implement a runner.

## Functions specific to R

### `r_load_files(files)`

Read the contents of the given files and return the result in a `promise`, to be used by a pre-submit task.

When run in the `pre_submit` note, this task adds an entry `r_files`, a list containing information about each of the files:

* `exists` - `true` if the file was loaded successfully, `false` if not.
* `text` - if the file contains text, the contents of the file as a string.
* `blob` - if the file is binary, a blob URL representing the file's contents. You can use a blob URL as the `src` attribute for an `img` or `iframe` tag.

At the moment, only PDF files are recognised as binary. You can register other file types as binary by adding an entry to the JavaScript object `Numbas.extensions.programming.mime_types`.
