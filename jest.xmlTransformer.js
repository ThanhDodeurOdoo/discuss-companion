export default {
    process(content) {
        return {
            code: `export default ${JSON.stringify(content)};`
        };
    }
};
