const MODULE_ID = 'data-storage';

/**
 * Entry representing one record of data
 */
class Entry {
  /**
   * @param {string} id
   * @param {string} pack
   * @param {object} index { name, thumb, tags, type, desc };
   * @param {Document} document
   */
  constructor(id, pack, index, document) {
    this.id = id;
    this.pack = pack;
    Object.assign(this, index);
    if (document) this.document = document;
  }

  /**
   * UUID of the underlying Document
   */
  get uuid() {
    return `Compendium.${this.pack}.${game.packs.get(this.pack).documentClass.name}.${this.id}`;
  }

  /**
   * Update Entry
   * @param {object} update
   */
  async update(update) {
    if (foundry.utils.isEmpty(update)) return;

    // Sanitize index fields
    const indexUpdate = {};
    for (const [k, t] of Object.entries(this.INDEX_FIELDS)) {
      if (update[k] != null) {
        if (foundry.utils.getType(update[k]) !== t)
          throw Error(`Invalid index field type ${k}:${foundry.utils.getType(update[k])}`);
        indexUpdate[k] = update[k];
      }
    }
    Object.assign(this, indexUpdate);

    let toUpdate = {};
    if (update.data) foundry.utils.setProperty(toUpdate, `flags.${MODULE_ID}.data`, [update.data]);
    if (!foundry.utils.isEmpty(indexUpdate))
      foundry.utils.setProperty(toUpdate, `flags.${MODULE_ID}.index`, indexUpdate);

    // Apply update
    if (!foundry.utils.isEmpty(toUpdate)) {
      if (!this.document) await this.load();
      await this.document.update(update);
    }
  }

  /**
   * Retrieve data stored within the document
   * @returns {object}
   */
  async data() {
    if (!this.document) await this.load();
    return this.document.getFlag(MODULE_ID, 'data')[0];
  }

  /**
   * Load the document
   * @returns {Document}
   */
  async load() {
    if (!this.document) this.document = await fromUuid(this.uuid);
    if (!this.document) throw Error(`Unable to load Entry: ${this.uuid}`);
    return this.document;
  }
}

export class DataCollection {
  // Default pack the data records will be stored within
  static DEFAULT_PACK = 'world.data-storage';

  // ID of the special meta document which will store the index
  static META_INDEX_ID = 'DataStorageMetaD';

  // Entry fields stored within the index
  static INDEX_FIELDS = { name: 'string', thumb: 'string', tags: 'Array', type: 'string', desc: 'string' };

  static DEFAULT_THUMB = 'icons/svg/book.svg';

  static _init() {
    const managedDocumentTypes = game.settings.get(MODULE_ID, 'managedDocumentTypes');
    for (const documentType of managedDocumentTypes) {
      Hooks.on(`preUpdate${documentType}`, this._preUpdate.bind(this));
      Hooks.on(`update${documentType}`, this._update.bind(this));
      Hooks.on(`delete${documentType}`, this._delete.bind(this));
      Hooks.on(`preCreate${documentType}`, this._preCreate.bind(this));
      Hooks.on(`create${documentType}`, this._create.bind(this));
    }

    Hooks.on('activateCompendiumDirectory', (directory) => {
      if (game.settings.get(MODULE_ID, 'hideManagedPacks'))
        game.packs
          .filter((p) => p.index.get(DataCollection.META_INDEX_ID))
          .forEach((pack) => {
            directory.element.querySelector(`[data-pack="${pack.collection}"]`)?.setAttribute('hidden', true);
          });
    });
  }

  /**
   * =============================================================================
   * =================================== Hooks ===================================
   * =============================================================================
   */

  /**
   * If a Document has been created within a managed compendium without the use of Data Storage API a default index and empty data will be inserted here.
   * @param {Document} document
   * @param {object} data
   * @param {object} options
   * @param {object} userId
   */
  static _preCreate(document, data, options, userId) {
    if (
      document.collection.index.get(this.META_INDEX_ID) &&
      !foundry.utils.getProperty(data, `flags.${MODULE_ID}.index`)
    ) {
      foundry.utils.setProperty(data, `flags.${MODULE_ID}.index`, {
        name: document.name,
        thumb: this.DEFAULT_THUMB,
        tags: [],
        type: 'generic',
        desc: '',
      });
      foundry.utils.setProperty(data, `flags.${MODULE_ID}.data`, []);
    }
  }

  /**
   * Newly created documents within managed compendiums automatically update metadata document index
   * @param {Document} document
   * @param {object} options
   * @param {string} userId
   * @returns
   */
  static _create(document, options, userId) {
    if (game.user.id === userId && document.collection.index.get(this.META_INDEX_ID)) {
      document.collection.getDocument(this.META_INDEX_ID).then((metaDocument) => {
        const index = document.getFlag(MODULE_ID, 'index');
        metaDocument.setFlag(MODULE_ID, 'index', { [document.id]: index });
      });
    }
  }

  /**
   * Document deletion within managed collection automatically remove it from the metadata document index
   * @param {Document} document
   * @param {object} options
   * @param {string} userId
   */
  static _delete(document, options, userId) {
    if (game.user.id === userId && document.collection.index.get(this.META_INDEX_ID)) {
      document.collection.getDocument(this.META_INDEX_ID).then((metaDocument) => {
        metaDocument.update({ [`flags.${MODULE_ID}.index.-=${document.id}`]: null });
      });
    }
  }

  /**
   * Sync Document and index names
   * @param {Document} document
   * @param {object} change
   * @param {object} options
   * @param {string} userId
   */
  static _preUpdate(document, change, options, userId) {
    if (
      document.collection.index.get(this.META_INDEX_ID) &&
      document.id !== this.META_INDEX_ID &&
      ('name' in change || foundry.utils.getProperty(change, `flags.${MODULE_ID}.index.name`) != null)
    ) {
      if ('name' in change) foundry.utils.setProperty(change, `flags.${MODULE_ID}.index.name`, change.name);
      else change.name = change.flags[MODULE_ID].index.name;
    }
  }

  /**
   * Sync metadata Document updates with _dataStorageIndex
   * @param {Document} document
   * @param {object} change
   * @param {object} options
   * @param {string} userId
   * @returns
   */
  static _update(document, change, options, userId) {
    if (document.collection.index.get(this.META_INDEX_ID)) {
      // Handle entry document update
      if (
        document.id !== this.META_INDEX_ID &&
        game.user.id === userId &&
        foundry.utils.getProperty(change, `flags.${MODULE_ID}.index`)
      ) {
        const indexChanges = foundry.utils.getProperty(change, `flags.${MODULE_ID}.index`);

        document.collection.getDocument(this.META_INDEX_ID).then((metaDocument) => {
          metaDocument.update({ [`flags.${MODULE_ID}.index.${document.id}`]: indexChanges });
        });
      }

      // Handle meta document update
      if (
        document.id === this.META_INDEX_ID &&
        document.collection._dataStorageIndex &&
        foundry.utils.getProperty(change, `flags.${MODULE_ID}.index`)
      ) {
        const collection = document.collection;
        const indexChanges = foundry.utils.getProperty(change, `flags.${MODULE_ID}.index`);
        for (const [id, index] of Object.entries(indexChanges)) {
          if (id.startsWith('-=')) {
            collection._dataStorageIndex.delete(id.substring(2));
            continue;
          }

          const entry = collection._dataStorageIndex.get(id);
          if (entry) Object.assign(entry, index);
          else {
            collection._dataStorageIndex.set(
              id,
              new Entry(id, collection.collection, document.getFlag(MODULE_ID, 'index')[id])
            );
          }
        }
      }
    }
  }

  // ======================= end of Hooks ================================

  /**
   * Retrieves a compendium and create a metadata document within it
   * If it's a DEFAULT_PACK and does not exist it will be created
   * @param {string} packId
   * @returns
   */
  static async _initCompendium(packId) {
    // Get/Create compendium
    let compendium = game.packs.get(packId);
    if (!compendium && packId === this.DEFAULT_PACK) {
      // Use any managed document type
      const type = game.settings.get(MODULE_ID, 'managedDocumentTypes')[0];
      compendium = await CompendiumCollection.createCompendium({
        label: 'Data Storage',
        type,
        packageType: 'world',
      });
    }

    // Get/Create metadata document
    let metadataDocument = await compendium?.getDocument(this.META_INDEX_ID);
    if (compendium && !metadataDocument) {
      const documents = await pack.documentClass.createDocuments(
        [
          {
            _id: this.META_INDEX_ID,
            name: '!!! METADATA: DO NOT DELETE !!!',
            flags: { [MODULE_ID]: { index: {} } },
          },
        ],
        {
          pack: packId,
          keepId: true,
        }
      );
      metadataDocument = documents[0];
    }

    return { compendium, metadataDocument };
  }

  /**
   * Save provided data as a document within the working compendium
   * Name, thumb, tags, type, and desc are index information
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
  static async save({
    name = 'New Entry',
    thumb = this.DEFAULT_THUMB,
    tags = [],
    type = 'data-storage-generic',
    desc = '',
    data,
    pack = this.DEFAULT_PACK,
  } = {}) {
    if (foundry.utils.isEmpty(data)) throw Error('No data provided for storage.');

    const { compendium, metadataDocument } = await this._initCompendium(pack);
    if (!compendium) throw Error('Unable to retrieve pack: ', pack);

    const index = { name, thumb, tags, type, desc };
    await compendium.documentClass.createDocuments([{ name, flags: { [MODULE_ID]: { data: [data], index } } }], {
      pack: metadataDocument.pack,
      [MODULE_ID]: true,
    });
  }

  /**
   * Retrieves entries matching the provided criteria.
   * @param {*} param0
   * @returns
   */
  static async retrieve({ uuid, name, types, query, tags, matchAnyTag = true, full = false, entries } = {}) {
    if (uuid) {
      const uuids = Array.isArray(uuid) ? uuid : [uuid];
      entries = await this.getEntriesFromUUID(uuids, { full });
    } else if (!name && !types && !tags && !query)
      throw Error('UUID, Name, Types, Tags, and/or Query required to retrieve Entries.');
    else if (query && (types || tags || name))
      throw console.warn(`When 'query' is provided 'types', 'tags', and 'name' arguments are ignored.`);
    else {
      let search, negativeSearch;
      if (query) {
        ({ search, negativeSearch } = this.parseSearchQuery(query, { matchAnyTag }));
      } else {
        if (tags) {
          if (Array.isArray(tags)) tags = { tags, matchAnyTag };
          else if (typeof tags === 'string') tags = { tags: tags.split(','), matchAnyTag };
        }

        search = { name, types, tags };
      }
      if (!search && !negativeSearch) return [];

      if (entries) return entries.filter((entry) => this._matchEntry(entry, search, negativeSearch));
      else return await this._search(search, negativeSearch);
    }
  }

  static async _loadIndex(pack) {
    if (pack._dataStorageIndex) return;
    const metadataDocument = await pack.getDocument(this.META_INDEX_ID);
    const rawIndex = metadataDocument.getFlag(MODULE_ID, 'index');

    const index = new Collection();
    for (const [id, content] of Object.entries(rawIndex)) {
      index.set(id, new Entry(id, metadataDocument.pack, content));
    }

    pack._dataStorageIndex = index;
    return index;
  }

  static async _search(search, negativeSearch) {
    const results = [];
    for (const pack of game.packs) {
      if (!pack.index.get(this.META_INDEX_ID)) continue;
      if (!pack._dataStorageIndex) await this._loadIndex(pack);

      for (const entry of pack._dataStorageIndex) {
        if (this._matchEntry(entry, search, negativeSearch)) results.push(entry);
      }
    }

    return results;
  }

  /**
   * Match a entry against the provided search and negativeSearch
   * @param {Entry} entry
   * @param {object} search
   * @param {object} negativeSearch
   */
  static _matchEntry(entry, search, negativeSearch) {
    let match = true;

    if (search) {
      const { name, terms, types, tags } = search;
      if (name && name !== entry.name) match = false;
      else if (types && !types.includes(entry.type)) match = false;
      else if (terms && !terms.every((t) => entry.name.toLowerCase().includes(t))) match = false;
      else if (tags) {
        if (tags.noTags) match = !entry.tags.length;
        else if (tags.matchAnyTag) match = tags.tags.some((t) => entry.tags.includes(t));
        else match = tags.tags.every((t) => entry.tags.includes(t));
      }
    }
    if (match && negativeSearch) {
      const { name, terms, types, tags } = negativeSearch;
      if (name && name === entry.name) match = false;
      else if (types && types.includes(entry.type)) match = false;
      else if (terms && !terms.every((t) => !entry.name.toLowerCase().includes(t))) match = false;
      else if (tags) {
        if (tags.noTags) match = !!entry.tags.length;
        else if (tags.matchAnyTag) match = tags.tags.some((t) => !entry.tags.includes(t));
        else match = tags.tags.every((t) => !entry.tags.includes(t));
      }
    }

    return match;
  }

  /**
   * Returns provided UUIDs as Entries
   * @param {Array[string]|string} uuids
   * @param {object} [options]
   * @param {boolean} [options.full] Should the associated entry document be loaded?
   * @returns {Array[Entries]}
   */
  static async getEntriesFromUUID(uuids, { full = true }) {
    if (!Array.isArray(uuids)) uuids = [uuids];
    const entries = [];

    for (const uuid of uuids) {
      let { collection, documentId } = foundry.utils.parseUuid(uuid);
      const index = collection.index.get(documentId);

      if (index) {
        const metaIndex = (await collection.getDocument(META_INDEX_ID))?.getFlag(MODULE_ID, 'index');
        entries.push(new Entry(index._id, collection.collection, metaIndex[index._id]));
      }
    }

    if (full) return this._batchLoadEntries(entries);
    return entries;
  }

  /**
   * Batch load entry documents using pack.getDocuments({ _id__in: ids }) query.
   * @param {Array[Entry]} entries to be loaded with their document
   * @returns {Array[Entry]}
   */
  static async _batchLoadEntries(entries) {
    // Organize entries according to their packs
    const packToEntry = {};
    for (const entry of entries) {
      if (!entry.document) {
        const idToEntry = packToEntry[entry.pack] ?? {};
        idToEntry[entry.id] = entry;
        packToEntry[entry.pack] = idToEntry;
      }
    }

    // Load documents from each pack and assign them to entries
    for (const [pack, idToEntries] of Object.entries(packToEntry)) {
      const documents = await game.packs.get(pack).getDocuments({ _id__in: Object.keys(idToEntries) });
      for (const document of documents) {
        idToEntries[document.id].document = document;
      }
    }

    return entries;
  }

  /**
   * Parses a search query returning terms, tags, and type found within it
   * @param {String} query
   * @returns {object} query components
   */
  static parseSearchQuery(query, { matchAnyTag = true, noTags = false } = {}) {
    let search = { terms: [], tags: [], types: [] };
    let negativeSearch = { terms: [], tags: [], types: [] };

    query
      .trim()
      .split(' ')
      .filter(Boolean)
      .forEach((t) => {
        let tSearch = search;

        if (t.startsWith('-')) {
          t = t.substring(1);
          tSearch = negativeSearch;
        }

        if (t.length >= 3) {
          if (t.startsWith('#')) {
            let tag = t.substring(1).toLocaleLowerCase();
            if (tag === 'null') noTags = true;
            tSearch.tags.push(tag);
          } else if (t.startsWith('@')) tSearch.types.push(t.substring(1));
          else tSearch.terms.push(t.toLocaleLowerCase());
        }
      });

    [search, negativeSearch].forEach((s) => {
      if (!s.terms.length) delete s.terms;
      if (!s.types.length) delete s.types;
      if (!s.tags.length) delete s.tags;
      else s.tags = { tags: s.tags, matchAnyTag, noTags };
    });

    if (!Object.keys(search).length) search = undefined;
    if (!Object.keys(negativeSearch).length) negativeSearch = undefined;

    return { search, negativeSearch };
  }
}

Hooks.on('init', () => {
  globalThis.DataStorage = DataCollection;

  game.settings.register(MODULE_ID, 'managedDocumentTypes', {
    scope: 'world',
    config: false,
    type: Array,
    default: ['JournalEntry'], // CONST.COMPENDIUM_DOCUMENT_TYPES
  });

  game.settings.register(MODULE_ID, 'hideManagedPacks', {
    name: 'data-storage.hideManagedPacks.name',
    hint: 'data-storage.hideManagedPacks.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      foundry.applications.instances.get(foundry.applications.sidebar.tabs.CompendiumDirectory.tabName)?.render(true);
    },
  });

  DataCollection._init();
});
