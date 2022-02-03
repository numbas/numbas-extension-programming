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

## The code editor input method

The extension provides the [Ace editor](https://ace.c9.io/) as an input method for custom part types.
It has three options:

* **Code language** - The language to use for syntax highlighting.
* **Placeholder** - The initial content of the editor.
* **Editor theme** - The Ace theme to use. Only `textmate` is bundled with the extension.

## JME functions

### `run_code(language,codes)`

* `language` is a string containing the name of the code runner to use.
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

The `options` argument is an optional dictionary of options.
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
