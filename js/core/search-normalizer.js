export function normalizeDigits(v=''){return String(v).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))}
export function normalizeArabic(v=''){return normalizeDigits(String(v)).normalize('NFKC').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/[\u064B-\u065F\u0670]/g,'').replace(/ـ/g,'').replace(/\s+/g,' ').trim().toLowerCase()}
