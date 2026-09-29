// اختبارات نظام البطاقات الموحّد وسلامة تكوين الشريط الجانبي (بدون متصفح).
import {card,cardEmpty,cardError,cardLoading,cardSuccess,statusBadge,CARD_SIZE} from '../ui/card.js';
import {NAV_GROUPS} from '../ui/sidebar.js';
import {icon,ROUTE_ICONS} from '../ui/icons.js';

export function runCardSidebarTests(test,expect){
 test('بطاقات: الأحجام الأربعة معرفة',()=>{
  expect(Boolean(CARD_SIZE.sm&&CARD_SIZE.md&&CARD_SIZE.lg&&CARD_SIZE.full)).toBe(true);
 });
 test('بطاقات: البناء يحمل العنوان والجسم والإجراءات',()=>{
  const html=card({title:'جلسات اليوم',icon:'calendar',body:'<p>محتوى</p>',actions:'<button>فتح</button>',badge:'<span class="ux-badge">3</span>'});
  expect(html.includes('ux-card')).toBe(true);
  expect(html.includes('جلسات اليوم')).toBe(true);
  expect(html.includes('محتوى')).toBe(true);
  expect(html.includes('ux-card-actions')).toBe(true);
  expect(html.includes('ux-card-badge')).toBe(true);
 });
 test('بطاقات: الترتيب البصري عنوان ثم جسم',()=>{
  const html=card({title:'أ',body:'ب'});
  expect(html.indexOf('ux-card-head')<html.indexOf('ux-card-body')).toBe(true);
 });
 test('بطاقات: بطاقة قابلة للطي تحمل زر تبديل ومفتاح حفظ',()=>{
  const html=card({title:'قابلة للطي',body:'س',collapsible:true,persistKey:'test:x'});
  expect(html.includes('ux-card-toggle')).toBe(true);
  expect(html.includes('data-card-key="test:x"')).toBe(true);
 });
 test('بطاقات: حالات التحميل والفراغ والخطأ والنجاح',()=>{
  expect(cardLoading({lines:2}).includes('ux-state-loading')).toBe(true);
  expect(cardEmpty('لا توجد بيانات').includes('لا توجد بيانات')).toBe(true);
  expect(cardError('حدث خطأ').includes('إعادة المحاولة')).toBe(true);
  expect(cardSuccess('تم الحفظ').includes('تم الحفظ')).toBe(true);
 });
 test('بطاقات: شارة الحالة حسب النغمة',()=>{
  expect(statusBadge('نشط','ok').includes('ux-badge--ok')).toBe(true);
  expect(statusBadge('متأخر','danger').includes('ux-badge--danger')).toBe(true);
 });
 test('شريط جانبي: مجموعات وأقسام بلا تكرار مسارات',()=>{
  const routes=NAV_GROUPS.flatMap(g=>g.items.map(i=>i.route));
  expect(new Set(routes).size).toBe(routes.length);
  expect(routes.includes('dashboard')).toBe(true);
  expect(routes.includes('files')).toBe(true);
  expect(routes.includes('settings')).toBe(true);
 });
 test('شريط جانبي: كل عنصر له أيقونة موجودة فعلًا',()=>{
  for(const g of NAV_GROUPS)for(const it of g.items){
   if(!it.icon||!icon(it.icon))throw Error('أيقونة مفقودة: '+it.route);
  }
  expect(Boolean(ROUTE_ICONS.serviceRecords&&ROUTE_ICONS.bailiffs)).toBe(true);
 });
 test('شريط جانبي: أسماء واضحة بلا تضارب (لا عنصرين بنفس الاسم)',()=>{
  const labels=NAV_GROUPS.flatMap(g=>g.items.map(i=>i.label));
  expect(new Set(labels).size).toBe(labels.length);
 });
}
