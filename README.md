![GitHub Latest Version](https://img.shields.io/github/v/release/Aedif/foundry-data-storage?sort=semver)
![GitHub Latest Release](https://img.shields.io/github/downloads/Aedif/foundry-data-storage/latest/data-storage.zip)
![GitHub All Releases](https://img.shields.io/github/downloads/Aedif/foundry-data-storage/data-storage.zip)

# Foundry Data Storage

Library module to allow the use of compendiums as generic data storage

## API

### Store Data

If no pack is provied all data will be stored within `world.data-storage` pack.

```js
  /**
   * Store provided data as a document within a compendium
   * Name, thumb, tags, type, and desc are index fields
   * Data is the payload to be stored as a document
   * Index will also be stored as part of the document as a separate field for recovery purposes in-case the META/Index document is deleted
   * @param {object} [options]
   * @param {string} [options.name]        Name
   * @param {string} [options.thumb]       Thumbnail image
   * @param {Array[string]} [options.tags] Array of tags
   * @param {string} [options.type]        Data type
   * @param {string} [options.desc]        Data description
   * @param {object} [options.data]        Data to be stored
   * @param {object} [options.pack]        The pack the data is to be stored in
   * @returns
   */
  async DataStorage.store(options = {}) 
```

Examples: 
```js
await DataStorage.store({name: "TEST", data: { text: "Hello World!" }, tags: ["test"]});
await DataStorage.store({name: "TMFX Graph", type: "graph", data: {nodes: ["node_1", "node_2"], mockup: true }, tags: ["tmfx", "graph"]});
```

### Retrieve Data

```js
  /**
   * Retrieves entries matching the criteria
   * @param {object} options
   * @param {string} [options.uuid]                      UUID of the underlying Entry document
   * @param {string} [options.name]                      Entry name
   * @param {string|Array[string]} [options.types]       Entry type/s
   * @param {Array[string]} [options.tags]               Tags
   * @param {string} [options.query]                     Search query consisting of:
   *                                                       Space separated terms e.g. "red car"
   *                                                       Types e.g. "@tmfx-node"
   *                                                       Tags e.g. "#light #source"
   *                                                       Negative match e.g. "-red -#light"
   *                                                       Combination of all of the above e.g. "car -red @node #player"
   * @param {boolean} [options.matchAnyTag]              Should any or all tags be present within an entry for a match
   * @param {boolean} [options.load]                     If 'true' all entries will have their documents loaded before being returned
   * @param {boolean} [options.data]                     If 'true' array of all matched data will be returned instead of entries
   * @param {Array[Entry]} [options.entries]             If provided the search will be carried out on this array
   * @returns {Array[Entry]|Array[object]}
   */
   async DataStorage.retrieve({ uuid, name, types, query, tags, matchAnyTag = true, load = false, data = false, entries } = {})
```

Examples:

```js
await DataStorage.retrieve({name: 'tree'});
await DataStorage.retrieve({tags: ['tmfx', 'filter'], data: true});
await DataStorage.retrieve({query: 'red #light'});
```

### Browse Data

A simple data browser is provided which can be accessed via the module settings or `DataStorage.browser()`

![data_browser](https://github.com/user-attachments/assets/63eda376-788e-4c2d-9bdb-993d95460534)
