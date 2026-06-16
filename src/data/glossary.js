// Luxury / resale-fashion jargon corrections.
//
// Keyed by SOURCE language. Each entry maps a source-language term to the
// preferred English rendering. These are enforced AFTER machine translation
// via private-use-area sentinels (see translator.js), so the on-device engine
// can't silently mistranslate them (e.g. 정품 -> "genuine article" instead of
// the expected "Authentic").
//
// Extend per language as the glossary grows.
globalThis.LUXE_GLOSSARY = {
  ko: {
    "정품인증": "Authenticity Verified",
    "정품": "Authentic",
    "빈티지": "Vintage",
    "미사용": "Unused",
    "새상품": "Brand New",
    "중고": "Pre-owned",
    "한정판": "Limited Edition",
    "단종": "Discontinued",
    "정가": "Retail Price",
    "무료배송": "Free Shipping",
    "품절": "Sold Out",
    "재고": "In Stock",
    "S급": "Grade S (Like New)",
    "A급": "Grade A (Excellent)",
    "B급": "Grade B (Good)",
    "구성품": "Included Items",
    "더스트백": "Dust Bag",
    "보증서": "Certificate of Authenticity",
    "영수증": "Receipt",
    "택포": "Shipping Included",
    "네고": "Negotiable"
  },
  ja: {
    "新品未使用": "Brand New, Unused",
    "未使用": "Unused",
    "新品": "Brand New",
    "美品": "Excellent Condition",
    "中古": "Pre-owned",
    "正規品": "Authentic",
    "本物": "Genuine",
    "限定": "Limited Edition",
    "廃盤": "Discontinued",
    "定価": "Retail Price",
    "送料無料": "Free Shipping",
    "在庫": "In Stock",
    "売り切れ": "Sold Out",
    "付属品": "Included Items",
    "保証書": "Certificate of Authenticity",
    "ヴィンテージ": "Vintage"
  },
  zh: {
    "正品": "Authentic",
    "全新": "Brand New",
    "二手": "Pre-owned",
    "限量": "Limited Edition",
    "包邮": "Free Shipping",
    "现货": "In Stock",
    "已售罄": "Sold Out",
    "专柜价": "Retail Price"
  }
};
