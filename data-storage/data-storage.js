const MODULE_ID = 'data-storage';

/**
 * Entry representing one record of data
 */
class Entry {
  constructor(id, pack, index, document) {
    this.id = id;
    this.pack = pack;
    Object.assign(this, index);
    if (document) this.document = document;
  }

  /**
   * UUID of the underlying JournalEntry document
   */
  get uuid() {
    return `Compendium.` + this.pack + '.JournalEntry.' + this.id;
  }

  /**
   * Override data stored within this entry with the update
   * @param {object} update
   */
  async update(update) {
    if (!this.document) await this.load();
    this.document.setFlag(MODULE_ID, 'data', [update]);
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
   * @returns {JournalEntryDocument}
   */
  async load() {
    if (!this.document) this.document = await fromUuid(this.uuid);
    if (!this.document) throw Error(`Unable to load Entry: ${this.uuid}`);
    return this.document;
  }
}

export class DataCollection {
  static workingPack;

  // Default pack the data records will be stored within
  static DEFAULT_PACK = 'world.data-storage';

  // ID of the special meta document which will store the index
  static META_INDEX_ID = 'DataStorageMetaD';

  /**
   * Retrieves a pack, it one doesn't exist and if it's a DEFAULT_PACK; create it
   * @param {string} packId
   * @returns
   */
  static async _initCompendium(packId) {
    let compendium = game.packs.get(packId);
    if (!compendium && packId === this.DEFAULT_PACK) {
      compendium = await CompendiumCollection.createCompendium({
        label: 'Data Storage',
        type: 'JournalEntry',
        packageType: 'world',
      });

      await this._initMetaDocument(packId);
    }

    return compendium;
  }

  /**
   * Initializes a special metadata document which will contain the index of all the records
   * @param {string} packId
   * @returns
   */
  static async _initMetaDocument(packId) {
    const compendium = game.packs.get(packId);
    const metaDoc = await compendium.getDocument(this.META_INDEX_ID);
    if (metaDoc) return metaDoc;

    const documents = await compendium.createDocument(
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
    return documents[0];
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
   * @returns {Entry}                      Fully loaded 'Entry' instance
   */
  static async save({
    name = 'New Entry',
    thumb = 'icons/svg/book.svg',
    tags = [],
    type = 'generic',
    desc = '',
    data,
  } = {}) {
    if (foundry.utils.isEmpty(data)) throw Error('No data provided for storage.');

    let metaDocument;
    let pack;

    try {
      pack = await this._initCompendium(this.workingPack);
      if (!pack) throw Error('Unable to retrieve working pack: ', this.workingPack);
      metaDocument = await this._initMetaDocument(this.workingPack);
    } catch (e) {
      // Fail-safe. Return back to DEFAULT_PACK
      console.log(e);
      console.log(`FAILED TO LOAD WORKING PACK {${this.workingPack}}`);
      console.log('RETURNING TO DEFAULT');
      await game.settings.set(MODULE_ID, 'workingPack', this.DEFAULT_PACK);
      this.workingPack = this.DEFAULT_PACK;
      pack = await this._initCompendium(this.workingPack);
      metaDocument = await this._initMetaDocument(this.workingPack);
    }

    const index = { name, thumb, tags, type, desc };

    const documents = await pack.createDocument([{ name, flags: { [MODULE_ID]: { data: [data], index } } }], {
      pack: metaDocument.pack,
    });

    const document = documents[0];
    await metaDocument.setFlag(MODULE_ID, 'index', { [document.id]: index });

    return new Entry(document.id, document.pack, index, document);
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
  _matchEntry(entry, search, negativeSearch) {
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
