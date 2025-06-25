const MODULE_ID = 'data-storage';

export default class DataBrowser extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static _entryPartial = `modules/${MODULE_ID}/templates/entry-partial.hbs`;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-browser`,
    classes: ['data-browser', 'directory', 'sidebar-tab'],
    form: {
      closeOnSubmit: false,
    },
    window: {
      contentClasses: ['standard-form'],
      resizable: true,
      minimizable: true,
      title: 'Data Browser',
    },
    position: {
      width: 330,
      height: 800,
    },
    actions: {
      selectType: DataBrowser._onSelectType,
      selectTag: DataBrowser._onSelectTag,
      delete: DataBrowser._onDelete,
    },
  };

  /** @override */
  static PARTS = {
    header: { template: `modules/${MODULE_ID}/templates/header-search.hbs` },
    typestags: { template: `modules/${MODULE_ID}/templates/types-tags.hbs` },
    main: {
      template: `modules/${MODULE_ID}/templates/main.hbs`,
      templates: [DataBrowser._entryPartial],
    },
  };

  /** @inheritDoc */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    switch (partId) {
      case 'typestags':
        await this._prepareTypesTagsContext(context, options);
        break;
      case 'main':
        await this._prepareMainContext(context, options);
        break;
    }
    return context;
  }

  /* -------------------------------------------- */

  async _prepareTypesTagsContext(context, options) {
    const entries = this._entries ?? (await DataStorage.retrieve({ query: '-glkasrdjgsdrkgjsdrg' }));

    // Gather types and tags
    const types = new Set();
    const tags = new Set();
    for (const entry of entries) {
      types.add(entry.type);
      for (const tag of entry.tags) tags.add(tag);
    }

    Object.assign(context, {
      types,
      tags,
      count: entries.length,
    });
  }

  async _prepareMainContext(context, options) {
    Object.assign(context, {
      entryPartial: DataBrowser._entryPartial,
      entries: this._entries,
    });
  }

  /** @inheritDoc */
  _attachPartListeners(partId, element, options) {
    super._attachPartListeners(partId, element, options);
    switch (partId) {
      case 'header':
        this._attachHeaderListeners(element, options);
        break;
    }
  }

  _attachHeaderListeners(element, options) {
    element.querySelector('input').addEventListener('input', this._onSearchInput.bind(this));
  }

  // Throttle input and perform search
  _onSearchInput(event) {
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this._onSearch(event), 250);
  }

  async _onSearch(event) {
    if (!event.target.value.trim()) this._entries = null;
    else this._entries = await DataStorage.retrieve({ query: event.target.value });

    this.render({ parts: ['main', 'typestags'] });
  }

  static _onSelectType(event) {
    this._toggleSearchValue('@' + event.target.text);
  }

  static _onSelectTag(event) {
    this._toggleSearchValue('#' + event.target.text);
  }

  _toggleSearchValue(val) {
    const search = this.element.querySelector('input[type="search"]');

    if (search.value.includes(val)) search.value = search.value.replaceAll(val, '');
    else search.value = search.value + ' ' + val;

    search.dispatchEvent(new Event('input'));
  }

  static async _onDelete(event) {
    const element = event.target.closest('.entry');
    const entries = await DataStorage.retrieve({ uuid: element.dataset.entryUuid });
    entries[0].delete();
    element.remove();
  }
}
