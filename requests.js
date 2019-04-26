const gapi = require('googleapis');

const aliases = {
    strength: "STR",
    fortitude: "FOR",
    agility: "AGL",
    intellect: "INT",
    intelligence: "INT",
    imagination: "IMG",
    charm: "CHR",
    charisma: "CHR",

    gel_viscosity: "gv",
    viscosity: "gv",
    luck_points: "lp",
    luck: "lp",
    magic_bullshit: "mb",
    magic: "mb",

    def: "defence",
    experience: "xp",
    handle: "chumhandle",
}

function batchGet(id, ranges, sheets) {
    return new Promise((resolve, reject) => {
        sheets.spreadsheets.values.batchGet({
            spreadsheetId: id,
            ranges
        }, (err, res) => {
            if (err) {
                reject(err);
            } else {
                resolve(res.data.valueRanges.map(val => {
                    if (val.values && val.values[0]) {
                        return val.values[0][0];
                    } else {
                        return '????';
                    }
                }));
            }
        });
    });
}

function batchSet(id, pairs, sheets) {
    return new Promise((resolve, reject) => {
        sheets.spreadsheets.values.batchGet({
            spreadsheetId: id,
            ranges: pairs.map(pair => pair[0])
        }, (err, res) => {
            if (err) {
                reject(err);
                return;
            } else {
                const oldValues = res.data.valueRanges.map(val => {
                    if (val.values && val.values[0]) {
                        return val.values[0][0];
                    } else {
                        return '????';
                    }
                });

                sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId: id,
                    resource: {
                        valueInputOption: 'USER_ENTERED',
                        data: pairs.map(([key, value]) => {
                            return {
                                range: key,
                                values: [[value]]
                            }
                        })
                    }
                }, (err, res) => {
                    if (err) {
                        reject(err);
                    } else {
                        const newValues = pairs.map(pair => pair[1]);
                        resolve(oldValues.map((old, i) => [old, newValues[i]]));
                    }
                });
            }
        })
    });
}

function getTraits(id, subsheet, config, sheets) {
    const traits = ['STR', 'FOR', 'AGL', 'INT', 'IMG', 'CHR'];

    const sheetmap = config.docmap[subsheet];
    const traitmap = sheetmap.traits;

    return batchGet(
        id,
        traits
            .map(trait => `${subsheet}!${traitmap.rating}${traitmap[trait]}`)
            .concat(
                traits.map(trait => `${subsheet}!${traitmap.mod}${traitmap[trait]}`)
            ),
        sheets
    )
        .then(response => {
            const ratings = response.slice(0, traits.length);
            const mods = response.slice(traits.length);

            return traits.map((trait, i) => [trait, ratings[i], mods[i]]);
        });
}

const gristTypes = [
    'build', 'shale', 'tar', 'chalk', 'iodine', 'marble',
    'mercury', 'ruby', 'gold', 'uranium', 'diamond', 'artifact'
];

function getGrist(id, config, sheets, types = gristTypes) {
    const invalid = types.filter(type => !gristTypes.includes(type.toLowerCase()));
    if (invalid.length !== 0) {
        throw new Error('invalid grist types: ' + invalid.join(' '));
    }

    const gristmap = config.docmap.SYLLADEX.grist;

    return batchGet(
        id,
        types
            .map(type => `SYLLADEX!${gristmap[type.toLowerCase()]}`),
        sheets
    )
        .then(response => {
            return types.map((type, i) => [type, response[i]]);
        });
}

function setGrist(id, config, sheets, pairs) {
    const invalid = pairs
          .map(pair => pair[0])
          .filter(type => !gristTypes.includes(type.toLowerCase()));
    if (invalid.length !== 0) {
        throw new Error('invalid grist types: ' + invalid.join(' '));
    }

    const gristmap = config.docmap.SYLLADEX.grist;

    return batchSet(
        id,
        pairs
            .map(([type, value]) => [`SYLLADEX!${gristmap[type.toLowerCase()]}`, value]),
        sheets
    )
        .then(response => {
            return pairs.map((pair, i) => [pair[0], response[i][0], response[i][1]]);
        });
}

function getData(id, subsheet, fields, config, sheets) {
    const sheetmap = config.docmap[subsheet];

    const ranges = fields
          .map(field => {
              const lc = field.toLowerCase();
              if (sheetmap[lc]) {
                  return lc;
              } else if (aliases[lc]) {
                  return aliases[lc];
              } else {
                  throw new Error(`Unknown field: ${field}`);
              }
          })
          .map(field => `${subsheet}!${sheetmap[field]}`);

    return batchGet(
        id,
        ranges,
        sheets
    )
        .then(response => {
            return fields.map((field, i) => [field, response[i]]);
        });
}

function setData(id, subsheet, pairs, config, sheets) {
    const sheetmap = config.docmap[subsheet];

    const set_pairs = pairs
          .map(([field, value]) => {
              const lc = field.toLowerCase();
              if (sheetmap[lc]) {
                  return [lc, value];
              } else if (aliases[lc]) {
                  return [aliases[lc], value];
              } else {
                  throw new Error(`Unknown field: ${field}`);
              }
          })
          .map(([field, value]) => [`${subsheet}!${sheetmap[field]}`, value]);

    return batchSet(
        id,
        set_pairs,
        sheets
    )
        .then(response => {
            return set_pairs.map(([field], i) => [field, response[i][0], response[i][1]]);
        });
}

module.exports = {
    batchGet,
    batchSet,
    getTraits,
    getGrist,
    setGrist,
    getData,
    setData,
};
