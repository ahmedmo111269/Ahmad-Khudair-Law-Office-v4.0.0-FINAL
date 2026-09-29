// اختبارات تنسيق أرقام الملفات الموحّد: الرئيسي/الفرعي/الإعلانات، الصيغ القديمة، الأرقام العربية.
import {parseFileNumber,formatFileNumber,fileKindLabel,fileNumberChip,formatOfficialNumber} from '../core/file-number.js';

export function runFileNumberTests(test,expect){
 test('رقم الملف: تحليل كود الملف الرئيسي',()=>{
  const p=parseFileNumber('CL-2026-000002');
  expect(p.kind).toBe('main');expect(p.year).toBe(2026);expect(p.seq).toBe(2);
 });
 test('رقم الملف: تحليل كود الملف الفرعي',()=>{
  const p=parseFileNumber('LF-2026-000001');
  expect(p.kind).toBe('sub');expect(p.year).toBe(2026);expect(p.seq).toBe(1);
 });
 test('رقم الملف: الصيغة القديمة 2026/0001 تُعرض فرعي 1/2026',()=>{
  expect(formatFileNumber('2026/0001')).toBe('1/2026');
  expect(parseFileNumber('2026/0001').kind).toBe('sub');
 });
 test('رقم الملف: عرض بسيط بدون سابقة',()=>{
  expect(formatFileNumber({fileNumber:'LF-2026-000001'})).toBe('1/2026');
  expect(formatFileNumber({clientCode:'CL-2026-000002'})).toBe('2/2026');
 });
 test('رقم الملف: عرض مع السابقة النوعية',()=>{
  expect(formatFileNumber({clientCode:'CL-2026-000002'},{withKind:true})).toBe('ملف رئيسي: 2/2026');
  expect(formatFileNumber({fileNumber:'LF-2026-000001'},{withKind:true})).toBe('ملف فرعي: 1/2026');
 });
 test('رقم الملف: الأرقام العربية تُطبَّع لللاتينية',()=>{
  expect(formatFileNumber('CL-٢٠٢٦-٠٠٠٠٠٢')).toBe('2/2026');
  expect(formatFileNumber('LF-٢٠٢٥-٠٠٠٠١٤')).toBe('14/2025');
 });
 test('رقم الملف: قيم غير معروفة تمر كما هي بلا كسر',()=>{
  expect(formatFileNumber('')).toBe('');
  expect(formatFileNumber('غير معروف')).toBe('غير معروف');
  expect(formatFileNumber(null)).toBe('');
 });
 test('رقم الملف: تمييز النوع',()=>{
  expect(fileKindLabel({clientCode:'CL-2026-000002'})).toBe('رئيسي');
  expect(fileKindLabel({fileNumber:'LF-2026-000001'})).toBe('فرعي');
 });
 test('رقم الملف: عداد الإعلانات مستقل بصيغة موحدة',()=>{
  expect(formatFileNumber('SR-2026-000005')).toBe('5/2026');
  expect(parseFileNumber('SR-2026-000005').kind).toBe('service');
 });
 test('رقم الملف: الشارة تحمل النوع والرقم وتلميح الكود التقني',()=>{
  const chip=fileNumberChip({fileNumber:'LF-2026-000001'});
  expect(chip.includes('fno-sub')).toBe(true);
  expect(chip.includes('1/2026')).toBe(true);
  expect(chip.includes('LF-2026-000001')).toBe(true); // الكود التقني في التلميح فقط
  const main=fileNumberChip({clientCode:'CL-2026-000002'});
  expect(main.includes('fno-main')).toBe(true);
  expect(main.includes('2/2026')).toBe(true);
 });
 test('رقم الملف: لا يخلط بين الرقم الداخلي ورقم القضية الرسمي',()=>{
  expect(formatOfficialNumber({caseNumber:'1545',caseYear:'2026'})).toBe('1545/2026');
  expect(formatOfficialNumber({caseNumber:'',caseYear:''})).toBe('');
  // الرقم الرسمي لا يُفسَّر كرقم ملف
  expect(parseFileNumber('1545/2026')?.kind!=='main').toBe(true);
 });
}
