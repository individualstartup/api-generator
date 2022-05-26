import * as fs from 'fs';
import * as handlebars from "handlebars";
import {OpenAPIV3} from "openapi-types";
import Document = OpenAPIV3.Document;
import ReferenceObject = OpenAPIV3.ReferenceObject;
import ArraySchemaObject = OpenAPIV3.ArraySchemaObject;
import NonArraySchemaObject = OpenAPIV3.NonArraySchemaObject;
import SchemaObject = OpenAPIV3.SchemaObject;
import * as http from "http";


console.log(`Directory name is ${__dirname}`);

const append = function(str : string, suffix: string) {
    if (typeof str === 'string' && typeof suffix === 'string') {
        return str + suffix;
    }
    return str;
};

handlebars.registerHelper('append', append);

handlebars.registerHelper('printDataOfPresentOrEmpty', (definition: any[], httpMethod) => {
    const containBody = definition.find(item => item.name === 'body') !== undefined;
    if (containBody) {
        return '{body}';
    }
    return "{}";
});

handlebars.registerHelper('generateMethodSignature', function (params: Parameter[], outputParam: DataClassField, options: any) {
    const p = params.map((item) => {
        return `${item.name}: ${item.type}`;
    });
    const dataCallbackType = outputParam ? `data : ${outputParam.type}` :"";
    if (p.length == 0)
        return `onSuccess: ((${dataCallbackType})=>void), hashAuthentication?: string, callbacks?: Callbacks`;
    else
        return `${p}, onSuccess: ((${dataCallbackType})=>void), hashAuthentication?: string, callbacks?: Callbacks`;
});

handlebars.registerHelper('generateMethodSignatureImpl', function (params: Parameter[], outputParam: DataClassField, options: any) {
    const p = params.map((item) => {
        return `${item.name}: ${item.type}`;
    });
    const dataCallbackType = outputParam ? `data : ${outputParam.type}` :"";
    if (p.length == 0)
        return `onSuccess: ((${dataCallbackType})=>void), hashAuthentication: string = null, callbacks: Callbacks ={}`;
    else
        return `${p}, onSuccess: ((${dataCallbackType})=>void), hashAuthentication: string = null, callbacks: Callbacks ={}`;
});

handlebars.registerHelper('prepareURI', function (uri: string, options: any) {
    return uri.replace(new RegExp('{', 'g'), '${');
});

handlebars.registerHelper('generateDataIfPresent', (definition: any[], httpMethod) => {
    const containBody = definition.find(item => item.name === 'body') !== undefined;
    if (containBody) {
        return 'body, ';
    } else if (httpMethod === 'post' || httpMethod === 'put' || httpMethod === 'patch' )
        return '{}, ';
});

handlebars.registerHelper('generateBodyIfPresent', (definition: any[]) => {
    const containBody = definition.find(item => item.name === 'body') !== undefined;
    if (containBody)
        return 'body: body,';
});

handlebars.registerHelper('addPageParamsIfPresent', (definition: any[]) => {
    const queryParams = definition.filter(d => d.inQuery).map(d=>d.isType ? `{${d.name}}` : d.name).join(', ');
    return `[${queryParams}]`;
});

const dataClassTemplateContent = fs.readFileSync(`${__dirname}/../src/dataClass.hbs`);
const dataClassTemplate = handlebars.compile(String(dataClassTemplateContent))

const methodTemplateContent = fs.readFileSync(`${__dirname}/../src/methods.hbs`);
const methodTemplate = handlebars.compile(String(methodTemplateContent));

const parseApi = (file: string): Document => {
    const buffer = fs.readFileSync(file);
    const parsed = JSON.parse(String(buffer));
    return parsed;
}


const isReferenceObject = (schema: ReferenceObject | ArraySchemaObject | NonArraySchemaObject | undefined): schema is ReferenceObject => {
    return (schema as ReferenceObject).$ref !== undefined;
}

const isArrayScheme = (schema: ReferenceObject | ArraySchemaObject | NonArraySchemaObject | undefined): schema is ArraySchemaObject => {
    return (schema as ArraySchemaObject).items !== undefined;
}

const isNonArraySchemaObject = (schema: ReferenceObject | ArraySchemaObject | NonArraySchemaObject | undefined): schema is NonArraySchemaObject => {
    return (schema as NonArraySchemaObject).type !== undefined;
}


interface DataClassField {
    name: string;
    optional: boolean;
    type: string;
}

const toJavascriptType = (type: any): string => {
    switch (type) {
        case "integer": {
            return "number"
        }
        case "string": {
            if (type.enum !== undefined) {
                // @ts-ignore
                return type.enum.map(value => `"${value}"`).join(" | ");
            }
            return "string";
        }
        case "object":
            return "any";
        // FIXME: hack
        case "array":
            return "string[]";
        default:
            return type || 'UNKNOWN';
    }
}


const resolveType = (propertyName : string, newEnums: any[], definition?: ReferenceObject | SchemaObject): string => {
    // @ts-ignore
    const isEnum = (definition.enum || []).length > 0;

    const enumName = propertyName.charAt(0).toUpperCase() + propertyName.slice(1) + "Enum";
    // @ts-ignore
    const enumObject = {enumName: enumName, values: definition.enum || []};

    if (isEnum) {
        console.log(`isEnum = true, ${JSON.stringify({definition, propertyName}, null, 2)}`);
        newEnums.push(enumObject);
    }



    if (isReferenceObject(definition)) {
        // dereference
        return definition.$ref.replace('#/components/schemas/', '');
    } else if (isArrayScheme(definition)) {
        // @ts-ignore
        if (definition.items.$ref !== undefined) {
            const type = isEnum ? enumName : ((definition as ArraySchemaObject).items as ReferenceObject).$ref.replace('#/components/schemas/', '');
            console.log(`1. Processing ${propertyName}, ${type}`);
            if (type === "array") {
                return `string[][]`;
            } else  {
            return `${type}[]`;
            }
        } else {
            if (isEnum)
                `${enumName}[]`;
            // @ts-ignore
            console.log(`2. Processing ${propertyName}, ${definition.items.type}`);
            // @ts-ignore
            return `${toJavascriptType(definition.items.type)}[]`;
        }
    } else if (isNonArraySchemaObject(definition)) {
        if (isEnum)
            return enumName;
        console.log(`3. Processing ${propertyName}, ${definition.type}`);
        return toJavascriptType(definition.type);
    }

    return 'any';
}

const generateDataClass = (name: string, dataClasses: any[], newEnums: any[], schema?: ReferenceObject | ArraySchemaObject | NonArraySchemaObject): string => {

    const items: DataClassField[] = [];

    // we implement only NonArraySchemaObject
    const n = schema as NonArraySchemaObject;

    Object.keys(n?.properties || {}).forEach((key) => {
        const item: DataClassField = {
            name: key,
            optional: !((n?.required || []).indexOf(key) >= 0),
            type: resolveType(key, newEnums, n?.properties?.[key])
        }
        items.push(item);
    });

    const renderedDefinition = dataClassTemplate({name, items});
    return renderedDefinition;
}



/**
 * returns
 * data: Type or nothing
 * @param response200
 */
const resolveOutputType = (response200 : any): DataClassField | undefined => {
    if (response200.content === undefined)
        return undefined;
    else {
        const firstKey = Object.keys(response200.content)[0];
        const schemaDef = response200.content[firstKey];

        const schema = schemaDef.schema;
        if (schema.type === "integer")
            return {name: "data", type: "number", optional: false};
        if (schema.$ref !== undefined) {
            const type = schema.$ref.replace("#/components/schemas/", "");
            return {name: "data", type: type, optional: false};
        }
        if (schema.type === "array") {
            if (schema.items.$ref !== undefined) {
            const type = schema.items.$ref.replace("#/components/schemas/", "");
            if (schema.items.type === "array") {
                return {name: "data", type: `string[][]`, optional: false};
            } else {
                return {name: "data", type: `${type}[]`, optional: false};
            }
            } else {
                return {name: "data", type: `${schema.items.type}[]`, optional: false};
            }
        }
        if (schema.type === "object") {
            return {name: "data", type: `any`, optional: false};
        }
    }

    return {name: "data", type: `any`, optional: false};
}

const parseSchema = (dataClasses: any[], api: Document) => {
    let newEnums : any[] = [];

    Object.entries(api.components?.schemas || {})
        .forEach((entry) => {
            dataClasses.push(generateDataClass(entry[0], dataClasses,  newEnums, entry[1],));
        })

    newEnums
        .reduce((array, value)=> {
            // @ts-ignore
            return [...array.filter(t=>t.enumName !== value.enumName), value];
        }, [])
        .forEach((entry : any) => {
            // @ts-ignore
            dataClasses.push(`export enum ${entry.enumName} { ${entry.values.map(t=>`${t}='${t}'`).join(',')} }`);
        })
    console.log(`Enums: ${JSON.stringify(newEnums, null, 2)}`);
}

const resolveInputObjects = (definition: any, dataClasses: any[]): Parameter[] => {
    const params: Parameter[] = [];

    const parameters: any[] = definition.parameters;

    if (parameters !== undefined) {
        const inParams: Parameter[] = parameters.map((value, index, array) => {

            const refType = value.schema.$ref;
            const type = value.schema.type;

            const ret: Parameter = {
                name: value.name,
                type: toJavascriptType(type || refType.replace('#/components/schemas/', '')),
                inQuery: value.in === 'query',
                isType: type
            }
            return ret;
        });

        inParams.forEach(a => params.push(a));
    }

    const body = definition?.requestBody?.content['application/json']?.schema?.$ref;

    if (body !== undefined) {
        const ret: Parameter = {
            name: 'body',
            type: body.replace('#/components/schemas/', ''),
            inQuery: false,
            isType: false
        }
        params.push(ret);
    }
    return params;
}

const processMethods = (uri: string, methods: any, dataClasses: any[]): Method[] => {
    let dataClassesTemp : any[] = [];

    return Object.keys(methods).map(key => {
        const definition = methods[key];
        const bodyObject = definition?.requestBody?.content['application/json']?.schema?.$ref;
        const responseParam = resolveOutputType(definition?.responses["200"]);
        // @ts-ignore
        const isPublic = definition.tags.some(t=>t === "public-api");

        const method: Method = {
            uri: uri,
            method: key,
            isPublic,
            name: `${definition.operationId}`,
            inputObjects: resolveInputObjects(definition, dataClassesTemp),
            bodyObject: bodyObject?.replace('#/components/schemas/', '') || 'any',
            outputObject: responseParam
        }
        return method;
    });
}

const parseMethods = (api: OpenAPIV3.Document, dataClasses: any[]): Method[] => {
    const methods: Method[] = [];

    Object.keys(api?.paths).map(key => {
        processMethods(key, api?.paths?.[key], dataClasses).forEach(item => methods.push(item));
    });
    return methods;
}

enum HttpMethod {
    PUT = 'put', GET = 'get', POST = 'post',
}

interface Parameter {
    name: string;
    type: string;
    inQuery: boolean;
    isType: boolean;
}

interface Method {
    name: string;
    method: string;
    uri: string;
    outputObject?: DataClassField;
    bodyObject: string;
    inputObjects: Parameter[];
    isPublic: boolean;
}

const generateName = (fileName : string) => {
    const f= fileName.substring(fileName.lastIndexOf("/") + 1);
    console.log(f);
    return `${f.substring(0, f.lastIndexOf("."))}.tsx`;
}

const generateModuleName = (fileName : string) => {
    const f= fileName.substring(fileName.lastIndexOf("/") + 1);
    console.log(f);
    const fname = `${f.substring(0, f.indexOf("."))}`;
    return fname.split("-").map(i=>i.charAt(0).toUpperCase()+i.substring(1)).join("")
}




const processFile = async (file: string) => {

    const api: Document = parseApi(file);

    const dataClasses: any[] = [];

    parseSchema(dataClasses, api);
    const methods: Method[] = parseMethods(api, dataClasses);

    const methodsTest = methods.filter((_, index) => index < 3);
    const comment = "/**\n" +
        " * THIS FILE IS GENERATED, DO NOT MODIFY THEM...\n" +
        " * contact @Miloslav Vlach\n" +
        " */";

    const imports = "import axios, { AxiosResponse } from 'axios';\n" +
        "import { GetIdTokenClaimsOptions, IdToken } from '@auth0/auth0-spa-js';"

    fs.writeFileSync(generateName(file), `${comment}\n${imports}\n\n ${dataClasses.join('\n')} \n\n\n ${methodTemplate({
        methods: methods,
        url: api?.servers?.[0]?.url || '',
        moduleName: generateModuleName(file).charAt(0).toLowerCase()+generateModuleName(file).substring(1),
        ModuleName: generateModuleName(file)
    })}`);
}

const file = process.argv[2];
processFile(file);
