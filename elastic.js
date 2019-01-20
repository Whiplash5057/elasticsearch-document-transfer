const elasticsearch = require('elasticsearch');
const fs = require('fs');

const config = require('./config');
const options = require('./options');


class Elastic{
    constructor(){
        this.target = {
            doc_count: {
                file: 0,
                elastic: 0
            }
        }
        this.batches = 0;
        this._scroll_id = null;
    }

    async init(){
        this.sourceClient = new elasticsearch.Client({
            host: config.source.host,
            log: options.elasticsearch.log_level
        })
        await this._checkConnection(this.sourceClient, 'source');

        if(options.consume.byElastic){
            this.targetClient = new elasticsearch.Client({
                host: config.target.host,
                log: options.elasticsearch.log_level
            })
            await this._checkConnection(this.targetClient, 'target');

            if(config.target.importMappingFromSource){
                this._transferMapping(this.sourceClient, this.targetClient);
            }
        }
    }

    async getDocsFromSourceElastic({batchSize = 20, query = {match_all: {}}, scrollTime = '10s'}){
        let results;

        //the first time; when scroll_id isn't generated yet
        if(!this._scroll_id){
            results = await this.sourceClient.search({
                scroll: options.elasticsearch.scroll_time,
                index: config.source.index,
                type: config.source.type,
                body: {
                    size: batchSize,
                    query: query
                }
            })
        }
        //the rest 
        else{
            results = await this.sourceClient.scroll({
                scrollId: this._scroll_id,
                scroll: options.elasticsearch.scroll_time
            })
        }
        this.batchesDone++;
        this._scroll_id = results._scroll_id;

        console.log('Batches done', this.batches);
        return results
    }

    addDocsToTargetElastic(rawHitsList){
        let body = rawHitsList.reduce((accumulator, hit) => {
            let index = {
                _index: config.target.index,
                _type: config.target.type,
                _id: ++this.target.doc_count.elastic
            }
            return accumulator.concat([index, hit._source])
        }, []);

        console.log('Elastic Doc Count', this.target.doc_count.elastic);
        return localClient.bulk({body});
    }

    async writeDocsToFile(rawHitsList){
        let body = rawHitsList.map(hits => {
            let index = {
                _index: config.target.index,
                _type: config.target.type,
                _id: ++this.target.doc_count.file
            }
            return this._writeLineToFile(config.target.filePath, `${{index}}\n${hits._source}`);
        })

        console.log('File Doc Count', this.target.doc_count.file);
        return Promise.all(body);     
    }

    async _checkConnection(client, clientName = ''){
        await client.ping({requestTimeout: 3000});
        console.log(`${clientName} client connected successfully`);
    }

    _writeLineToFile(path, line){
        line = line + '\n';
        return new Promise((resolve, reject) => {
            fs.appendFile(path, line, err => err? reject(err): resolve());
        })
    }

    async _transferMapping(source, target){
        let mapping = await source.indices.getMapping({
            index: config.source.index,
            type: config.source.type
        })
        console.log("Mapping: ", mapping);

        if(!await target.indices.exists({index: config.target.index}))
            await target.indices.create({index: config.target.index});

        return await target.indices.putMapping({
            index: config.target.index,
            type: config.target.type,
            body: mapping.search.mappings
        });
    }
}

module.exports = {Elastic}