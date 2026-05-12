// plugins/hardhat-sol-tests/index.js
// Hardhat plugin to enable Solidity test files (.sol) in the test runner

const { subtask, task, types } = require("hardhat/config");
const { TASK_TEST_GET_TEST_FILES } = require("hardhat/builtin-tasks/task-names");
const path = require("path");
const fs = require("fs");

function isSolidityFile(filePath) {
    return filePath.endsWith(".sol");
}

function isJavascriptFile(filePath) {
    return filePath.endsWith(".js");
}

function isTypescriptFile(filePath) {
    return filePath.endsWith(".ts");
}

function getAllFilesMatching(dir, filterFn) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...getAllFilesMatching(fullPath, filterFn));
        } else if (filterFn(entry.name)) {
            results.push(fullPath);
        }
    }
    return results;
}

module.exports = function () {
    // Override TASK_TEST_GET_TEST_FILES to also include .sol files
    subtask(TASK_TEST_GET_TEST_FILES, "Get all test files including Solidity")
        .addOptionalVariadicPositionalParam("testFiles", "An optional list of files to test", [])
        .setAction(async ({ testFiles }, { config }) => {
            if (testFiles.length !== 0) {
                // When specific files are passed, resolve them
                return testFiles.map((x) => path.resolve(process.cwd(), x));
            }
            // Default: scan test directory for .js, .ts, and .sol files
            const jsFiles = getAllFilesMatching(config.paths.tests, isJavascriptFile);
            const tsFiles = getAllFilesMatching(config.paths.tests, isTypescriptFile);
            const solFiles = getAllFilesMatching(config.paths.tests, isSolidityFile);
            return [...jsFiles, ...tsFiles, ...solFiles];
        });
};
