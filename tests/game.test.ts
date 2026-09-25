import { describe, expect, it } from 'vitest'
import {
  addCommercialProgram, advanceCompetitive, alterCommercialProgram, canResearch,
  initialGame, issueEquity, issueLoan, loadGame, programValidationError,
  research, researches, unitEconomics,
} from '../src/game'

const launch = () => addCommercialProgram(initialGame(), 'Home Receiver', 'Value homes', 145, .35, ['tube', 'am', 'utility'])
const close = advanceCompetitive

describe('program decisions', () => {
  it('rejects invalid or unavailable designs without spending cash', () => {
    const start = initialGame()
    const cases: Array<[string, number, number, string[]]> = [
      ['', 145, .35, ['tube', 'am', 'utility']],
      ['Radio', -20, .35, ['tube', 'am', 'utility']],
      ['Radio', 145, 1.2, ['tube', 'am', 'utility']],
      ['Radio', 145, .35, ['transistor', 'am', 'utility']],
      ['Radio', 145, .35, ['tube', 'tube', 'am', 'utility']],
      ['Radio', 145, .35, ['tube', 'am']],
    ]
    for (const [name, price, discount, parts] of cases) {
      expect(programValidationError(start, name, 'Value homes', price, discount, parts)).toBeTruthy()
      const result = addCommercialProgram(start, name, 'Value homes', price, discount, parts)
      expect(result.cash).toBe(start.cash)
      expect(result.programs).toHaveLength(0)
    }
    const broke = { ...start, cash: 19 }
    expect(addCommercialProgram(broke, 'Radio', 'Value homes', 145, .35, ['tube', 'am', 'utility']).programs).toHaveLength(0)
  })

  it('keeps edits inside the supported price, discount, marketing, and terms ranges', () => {
    const start = launch()
    const id = start.programs[0].id
    for (const [key, value] of [['price', Number.NaN], ['dealerDiscount', 1], ['marketing', -1], ['terms', 45]] as const) {
      const result = alterCommercialProgram(start, id, key, value)
      expect(result.programs[0]).toEqual(start.programs[0])
    }
  })

  it('uses the same unit economics in a quote and a closed quarter', () => {
    const start = launch()
    const quote = unitEconomics(start, start.programs[0])
    const next = close(start)
    const sold = next.programs[0].unitsSold
    expect(next.programs[0].revenue).toBeCloseTo(sold * quote.net / 1000)
    expect(next.ledger.cogs).toBeCloseTo(sold * (quote.materials + quote.labor + quote.warranty) / 1000)
  })
})

describe('research and financing', () => {
  it('charges RP when opening a project and retains quarterly cash funding', () => {
    const ready = close(close(initialGame()))
    const technology = researches.find(r => r.id === 'tubeTesting')!
    expect(canResearch(ready, technology)).toBe(true)
    const started = research(ready, technology.id)
    expect(started.research).toBe(ready.research - technology.cost)
    expect(started.projects).toHaveLength(1)
    expect(canResearch(started, researches.find(r => r.id === 'powerSupply')!)).toBe(false)
    const next = close(started)
    expect(next.ledger.rnd).toBe(4.5)
    expect(next.research).toBe(1)
  })

  it('limits bank notes and equity offerings', () => {
    const one = issueLoan(initialGame())
    const two = issueLoan(one)
    const blocked = issueLoan(two)
    expect(two.loans).toHaveLength(2)
    expect(blocked.loans).toHaveLength(2)
    expect(blocked.cash).toBe(two.cash)
    const equity = issueEquity(initialGame())
    expect(issueEquity(equity).cash).toBe(equity.cash)
    const nextYear = { ...equity, year: equity.year + 1 }
    expect(issueEquity(nextYear).cash).toBe(nextYear.cash + 120)
  })
})

describe('quarterly accounts', () => {
  for (const [terms, delay] of [[30, 1], [60, 2], [90, 3]] as const) {
    it(`collects ${terms}-day invoices after ${delay} quarter(s)`, () => {
      const launched = launch()
      let game = alterCommercialProgram(launched, launched.programs[0].id, 'terms', terms)
      game = close(game)
      const invoice = game.receivables[0]
      expect(invoice.amount).toBeGreaterThan(0)
      for (let i = 1; i < delay; i++) {
        game = close(game)
        expect(game.ledger.collections).toBe(0)
      }
      game = close(game)
      expect(game.ledger.collections).toBeCloseTo(invoice.amount)
    })
  }

  it('reconciles cash, expenses, profit, and loan repayment', () => {
    const ready = close(close(launch()))
    const withProject = research(ready, 'tubeTesting')
    const financed = issueLoan(withProject)
    const next = close(financed)
    const l = next.ledger
    expect(next.cash).toBeCloseTo(financed.cash + l.cashFlow, 1)
    expect(l.cashFlow).toBeCloseTo(l.collections - l.cogs - l.freight - l.marketing - l.rnd - l.overhead - l.interest - l.tax - l.principal)
    expect(l.profit).toBeCloseTo(l.revenue - l.cogs - l.freight - l.marketing - l.rnd - l.overhead - l.interest - l.tax)
    expect(next.debt).toBeCloseTo(financed.debt - l.principal)
    expect(next.history.at(-1)).toBe(next.cash)
  })
})

describe('save migration', () => {
  it('preserves a version 6 game and fills new accounting fields', () => {
    const old = { ...launch(), version: 6, research: 4, cash: 77 } as Record<string, unknown>
    delete old.lastEquityYear
    const ledger = { ...(old.ledger as Record<string, unknown>) }
    delete ledger.collections
    delete ledger.principal
    old.ledger = ledger
    const loaded = loadGame(old)
    expect(loaded.version).toBe(7)
    expect(loaded.cash).toBe(77)
    expect(loaded.research).toBe(4)
    expect(loaded.programs).toHaveLength(1)
    expect(loaded.lastEquityYear).toBeNull()
    expect(loaded.ledger.collections).toBe(0)
    expect(loaded.ledger.principal).toBe(0)
  })
})
