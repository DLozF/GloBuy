// COPY of ../../src/data/glossary.js, re-exported as an ESM module for the Worker.
// The extension keeps the canonical copy on `globalThis.GLOBUY_GLOSSARY`; this file
// mirrors it so the proxy can bake the per-language glossary into the LLM's system
// instruction. Keep the two in sync (or share via a build step later).
export const GLOSSARY = {
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
  },
  vi: {
    "Chính hãng": "Authentic",
    "Hàng mới": "Brand New",
    "Mới 100%": "Brand New",
    "Đã qua sử dụng": "Pre-owned",
    "Hàng cũ": "Pre-owned",
    "Hàng hiệu": "Designer",
    "Phiên bản giới hạn": "Limited Edition",
    "Miễn phí vận chuyển": "Free Shipping",
    "Freeship": "Free Shipping",
    "Còn hàng": "In Stock",
    "Hết hàng": "Sold Out",
    "Giá gốc": "Retail Price",
    "Nguyên hộp": "Full Box",
    "Bảo hành": "Warranty",
    "Phụ kiện": "Accessories"
  }
};
