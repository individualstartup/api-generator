#!/usr/bin/env node
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as handlebars from "handlebars";

console.log(`Directory name is ${__dirname}`);

handlebars.registerHelper('generateMethodSignature', function (params: any, options: any) {
    if (params === undefined || params === null)
        return '';
    return Object.entries(params).map((value, index, array) => {
        return `${value[0]}: ${value[1]}`;
    }).join(', ');
});

handlebars.registerHelper('toEnum', function (param: string, options: any) {
    return param.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).toUpperCase();
});

handlebars.registerHelper('generatePayloadParams', function (params: any, options: any) {
    if (params === undefined || params === null)
        return '{}';
    const par = Object.entries(params).map((value, index, array) => {
        return `${value[0]}`;
    }).join(', ');
    return `{${par}}`;
});

handlebars.registerHelper('joinDefinition', function (params: any, options: any) {
    return Object.keys(params).join(', \n');
});

handlebars.registerHelper('generateParams', function (params: any, options: any) {
    if (params === undefined || params === null)
        return '';
    const par = Object.entries(params).map((value, index, array) => {
        return `${value[0]}`;
    }).join(', ');
    return `${par}`;
});
handlebars.registerHelper('importDataTypes', (params: any, options: any) => {
    const imports = params.types.join(', \n');
    return `import {\n ${imports},\n} from '${params.from}'`;
});


const generate = (object: any, onGenerate: ((data: string) => void)) => {
    fs.readFile(`${__dirname}/../src/template.tsx.hbs`, (err, data) => {
        const template = handlebars.compile(String(data))
        onGenerate(template(object));
    });
}


const processFile = (file: string) => {
    fs.readFile(file, function (err, data) {
        if (err) {
            return console.error(err);
        }
        const output = yaml.load(String(data), {json: true});
        generate(output, (data) => {
            // @ts-ignore
            fs.writeFile(`${output.handler.name}Handler.tsx`, data, () => {
            });
        });
    });
}

const file = process.argv[2];
processFile(file);
