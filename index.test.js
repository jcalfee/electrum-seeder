/* eslint-env mocha */
const assert = require('assert')

const {randomBrainSeed, mnemonicToSeed, checkSeed, seedVersion} = require('.')

describe('Seed', () => {
  it('Stretches', () => { // S L O W
    const seed = 'possible mother domain sweet brown strategy element school february merit silver edit'
    const stretched = mnemonicToSeed(seed, 'passphrase')
    assert.equal(stretched.length, 64)
    assert.equal(stretched.toString('hex').substring(0, 8), '0c619b5d')
  })

  it('Random brain seed', () => {
    assert(randomBrainSeed({version: '01', entropy: [0]}))
    assert(randomBrainSeed({version: '01', entropy: 'entropy'}))
    assert(randomBrainSeed({version: '01', entropy: Buffer.from([0])}))
    assert(randomBrainSeed({version: '01', entropy: Buffer.from([0]), bits: 143}))
    assert(
            randomBrainSeed({version: '01', entropy: 'entropy'}) !==
            randomBrainSeed({version: '01', entropy: 'entropy'})
        )
  })

  it('Invalid entropy arg type', () => {
    throws(() => randomBrainSeed({entropy: 2}), /must be a string, buffer, or array/) // fails in browser
  })

  it('Catches type errors', () => {
    throws(() => mnemonicToSeed(), /seed string required/)
    throws(() => randomBrainSeed(), /Provide seedCallback parameter unless you plan to provide config.entropy/)
    assert(/this seed is only 2 words/.test(checkSeed('lazy dog').error))
    const seed = randomBrainSeed({entropy: 'entropy'})
    assert.equal(checkSeed(seed + ' nonword').error, 'Invalid brain seed')
    assert(/Invalid brain seed version, expecting 01 got /.test(checkSeed(seed + ' able').error))
    assert.equal(checkSeed(null).error, 'seed string required')
    assert(checkSeed(seed))
  })

  it('Random brain seed internal entropy', (done) => {
    randomBrainSeed(null, brainSeed => {
      const words = brainSeed.split(' ')
      assert(words.length <= 12, `A brain seed with more than 12 words: ${brainSeed}`)
      assert(words.length > 9, `Very odd, a seed with only ${words.length} words: ${brainSeed}`)
      done()
    })
  })

  it('Localization', () => {
    const check = language => {
      const seed = randomBrainSeed({entropy: 'entropy', language})
      assert.equal(seedVersion(seed), '01')
      assert(checkSeed(seed))
    }
    throws(() => check('pig_latin'), /Missing wordlist/)
    check('chinese_simplified')
    check('chinese_traditional')
    check('english')
    check('french')
    check('italian')
    check('japanese')
    check('spanish')
  })
})

/* istanbul ignore next */
function throws (fn, match) {
  try {
    fn()
    assert(false, 'Expecting error')
  } catch (error) {
    if (!match.test(error.message)) {
      error.message = `Error did not match ${match}\n${error.message}`
      throw error
    }
  }
}
