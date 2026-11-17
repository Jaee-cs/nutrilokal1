import { describe, expect, it } from 'vitest'
import {
  PUBLIC_BATCH_STATUS_META,
  productPublicPath,
  productPublicUrl,
} from './public-product'

describe('public product URL', () => {
  it('memakai path produk yang stabil berdasarkan ID', () => {
    expect(productPublicPath('p1')).toBe('/produk/p1')
    // ID di-encode agar aman dipakai sebagai bagian URL.
    expect(productPublicPath('a/b c')).toBe('/produk/a%2Fb%20c')
  })

  it('membangun URL absolut untuk QR dari origin yang diberikan', () => {
    expect(productPublicUrl('p1', 'https://nutrilokal.test')).toBe(
      'https://nutrilokal.test/produk/p1',
    )
  })
})

describe('label status batch publik', () => {
  it('menyediakan label untuk setiap status', () => {
    expect(Object.keys(PUBLIC_BATCH_STATUS_META).sort()).toEqual([
      'DITARIK',
      'HABIS',
      'KEDALUWARSA',
      'TERSEDIA',
    ])
  })

  it('tidak pernah menyebut batch yang ditarik sebagai tersedia', () => {
    expect(PUBLIC_BATCH_STATUS_META.DITARIK.label).not.toMatch(/tersedia/i)
    expect(PUBLIC_BATCH_STATUS_META.DITARIK.cls).toBe('error')
  })
})
