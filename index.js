/**
    @module seed
*/
const {normalize, checkWords, validWordlist, bip39} = require('bip39-checker')
const MoreEntropy = require('more-entropy')
const randomBytes = require('randombytes')
const createHmac = require('create-hmac')
const createHash = require('create-hash')
const BN = require('bn.js')

const ZERO = new BN()
const DEFAULT_VERSION = '01'

module.exports = {
  randomBrainSeed,
  mnemonicToSeed,
  seedVersion,
  checkSeed
}

/**
    @summary Create and validate brain seeds.  Operates similar to bip39 except this uses a version instead of a checksum and allows for more flexibility in bit strength.

    @description Create a random brain seed.  This about 12 random private words that may be used to generate private keys.  The brain seed is designed to be strong enough to resist off-line brute-force attacks.  This package uses the bip39 word list but differs in that it can embed a hidden version number in the brain seed (instead of a checksum) and allows for smaller variations in the bit strength (need not be multiples of 32 bits or 4 words).

    This brain seed is versioned which will assist in checked the brain seed against typing errors.  Before deriving private keys see the mnemonicToSeed function.

    randomBrainSeed is like bip39.generateMnemonic

    @see mnemonicToSeed(brainSeed)

    If additional entropy is not provided, the 'more-entropy' package is used and combined with nodes secureRandom number generator.

    @see https://www.npmjs.com/package/more-entropy
    @see https://www.npmjs.com/package/secure-random

    @arg {Array|Buffer|string} config.entropy - Any size Buffer or String but at least 132 bits are recommended. Additional entropy combined with secureRandom (@see https://github.com/keybase/more-entropy)

    @arg {function} [seedCallback = null] - Called when seed is available. Additional entropy combined with secureRandom (@see https://github.com/keybase/more-entropy)

    @arg {object} [config = {}]
    @arg {string} config.version - Up to 3 HEX characters (lowercase)
    @arg {number} [config.bits = 132] - Bit strength.  Should be at least 132.  Each hex digit in the version removes 4 bits from the strength but stretching adds 11 bits back.  If stretching can't be performed then at least 140 bits would be better.
    @arg {string} [config.language = 'english'] - chinese_simplified, chinese_traditional, english, french, italian, japanese, spanish

    @example seeder.randomBrainSeed(null, brainSeed => {})

    @return {string} undefined and seedCallback will be called.  If custom entropy is provided returns a new 12 word brain seed.
*/
function randomBrainSeed (config, seedCallback) {
  config = config || {}
  const {bits = 132, language = 'english'} = config
  let {entropy, version = DEFAULT_VERSION} = config

  // About key strength: http://docs.electrum.org/en/latest/seedphrase.html
  // https://github.com/jcalfee/electrum/blob/v2.8.2/lib/mnemonic.py#L170

  const bytes = Math.ceil(bits / 8)

  if (!entropy) {
    if (!seedCallback) {
      throw new TypeError('Provide seedCallback parameter unless you plan to provide config.entropy')
    }
    const moreEntropy = new MoreEntropy.Generator({work_min: 5})
    moreEntropy.generate(Math.max(bits, 132), newEntropy => {
      moreEntropy.stop()
      seedCallback(
        randomBrainSeed(Object.assign(config, {version, entropy: newEntropy}), seedCallback)
      )
    })
    return
  }

  let seedBuf = randomBytes(bytes)

  try {
    if (Array.isArray(entropy)) {
            // preserve entropy for array elements with a value over 255
            // require('assert').equal(entropy.length * 4, Buffer.from(new Int32Array(entropy).buffer).length)
      entropy = Buffer.from(new Int32Array(entropy).buffer)
    }
    seedBuf = createHash('sha256').update(entropy).update(seedBuf).digest().slice(0, bytes)
  } catch (err) {
    if (/string or a buffer/.test(err.message)) {
      throw new TypeError('entropy parameter must be a string, buffer, or array')
    }
    throw err
  }

    // Right shift to produce exactally N bits
  let entropyBn = new BN(seedBuf).shrn(Math.ceil(bits / 8) * 8 - bits)

    // mine for the correct version
  let brainSeed
  version = version.toLowerCase()
  for (let nonce = 1; nonce < Number.MAX_SAFE_INTEGER; nonce++) {
    entropyBn = entropyBn.add(new BN(nonce))
    brainSeed = bnToSeed(entropyBn, language)
    if (brainSeed && seedVersion(brainSeed, {versionLength: version.length}) === version) {
      // seedVersion => v2.8.2/lib/mnemonic.py#L181
      // const bitsBurnt = Math.floor(Math.log2(nonce - 1) + 1)
      // const checksumLen = Math.ceil(entropyBn.bitLength() / 32)
      // A 1 byte version and 4 bit checksum always burns 12 bits .. Just checking:
      // console.log(`bits burnt version ${bitsBurnt} checksum ${checksumLen}`)
      break
    }
  }
  return brainSeed
}

/** Stretching can be done prior to deriving private keys.  Adds 11 bits of
    entropy to compensate for the version.

    @arg {Brainseed} brainSeed
    @arg {string} version - Up to 3 HEX characters (lowercase)
    @example seeder.mnemonicToSeed(brainSeed)

    @return {Buffer} 64 bytes or 512 bits
*/
function mnemonicToSeed (brainSeed, passphrase = '') {
  brainSeed = normalize(brainSeed)
  return bip39.mnemonicToSeed(brainSeed, passphrase)
}

/**
    @typedef {object} Validity
    @property {boolean} Validity.valid
    @property {string} Validity.error
*/
/**
    All functions in seeder check the seed's validity already.  This is provided for
    extra user interface checking (prior to stretching for example).

    When a checksum is invalid, warn the user and ask if they would like to use it anyway.  This way
    you can recover phrases made by other apps in other languages.

    @arg {Brainseed} brainSeed
    @arg {string} version - Up to 3 HEX characters (lowercase)
    @example assert(seeder.checkSeed(brainSeed))
    @return {Validity}
*/
function checkSeed (brainSeed, {version = DEFAULT_VERSION, language = 'english'} = {}) {
  try {
    brainSeed = normalize(brainSeed)
    assertValidSeed(brainSeed, version, language)
    return {
      valid: true,
      error: null
    }
  } catch (err) {
    return {
      valid: false,
      error: err.message
    }
  }
}

/**
    @arg {Brainseed} private brain seed
    @example assert.equal(seeder.seedVersion(brainSeed), '01')
    @return {string} version digits in hex
*/
function seedVersion (brainSeed, {versionLength = DEFAULT_VERSION.length} = {}) {
  const key = 'Seed version' // https://github.com/jcalfee/electrum/blob/v2.8.2/lib/bitcoin.py#L203
  return createHmac('sha512', key).update(brainSeed).digest('hex')
        .substring(0, versionLength)
}

function assertValidSeed (brainSeed, version = DEFAULT_VERSION, language) {
  version = version.toLowerCase()
  if (!checkWords(brainSeed, language)) {
    throw new Error('Invalid brain seed')
  }
  const sv = seedVersion(brainSeed, {versionLength: version.length})
  if (sv !== version) {
    const words = brainSeed.split(' ').length
    const shortStr = words < 11 ? `.  Brain seeds are about 12 words but this seed is only ${words} words.` : ''
    throw new Error(`Invalid brain seed version, expecting ${version} got ${sv}${shortStr}`)
  }
}

function bnToSeed (i, language) {
  const wordlist = validWordlist(language)
  const words = []
  const totalWordLen = new BN(wordlist.length)
  while (i.cmp(ZERO)) {
    const idx = i.mod(totalWordLen).toNumber()
    words.push(wordlist[idx])
    i = i.div(totalWordLen)
  }
  return words.join(' ')
}
