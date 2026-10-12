// Record-context regression tests: relationship links must use registered routes and omit unavailable targets.
import {ENTITIES, entityRoute} from '../domain/entities.js';
import {kvHtml, bindRefLinks, recordPage} from '../modules/record-page.js';

export async function runRecordContextTests(test, expect) {
  test('سياق السجل: مراجع التنفيذ تفتح بطاقة التنفيذ المسجلة، لا مسار rec بديل', () => {
    const id = 'execution-context-link';
    expect(entityRoute('execution', id)).toBe(`exc:${id}`);
    expect(entityRoute('files', 'file-context-link')).toBe('file:file-context-link');
    expect(entityRoute('activityLog', 'activity-context-link')).toBe(null);
    const calls = [];
    const link = {dataset: {openRef: `execution:${id}`}, addEventListener(type, handler) { if (type === 'click') this.click = handler; }};
    bindRefLinks({go: route => calls.push(route)}, {querySelectorAll: selector => selector === '[data-open-ref]' ? [link] : []});
    link.click();
    expect(calls.join('|')).toBe(`exc:${id}`);
  });

  test('سياق السجل: المراجع غير المتاحة نص غير قابل للنقر وتظهر حالتها بوضوح', () => {
    const field = ENTITIES.executionParties.fields.find(item => item.k === 'executionId');
    const html = kvHtml([field], {executionId: 'deleted-execution-context'}, new Map());
    expect(html.includes('data-open-ref=')).toBe(false);
    expect(html.includes('السجل المرتبط غير متاح حاليًا')).toBe(true);
    const live = kvHtml([field], {executionId: 'live-execution-context'}, new Map([['live-execution-context', 'تنفيذ 12']]));
    expect(live.includes('data-open-ref="execution:live-execution-context"')).toBe(true);
  });

  test('صفحة القضية: بطاقة البيانات بارزة وسياق الإجراءات قابل للطي بلا السابق/التالي', async () => {
    const caseRow={id:'case-context-1',fileId:'file-context-1',stageType:'دعوى',numberType:'رقم دعوى',caseNumber:'471',caseYear:2026,subject:'موضوع الاختبار',clientCapacity:'مدعٍ',opponentCapacity:'مدعى عليه',isDeleted:false};
    const fileRow={id:'file-context-1',fileNumber:'2026/0041',title:'ملف سياق الاختبار',isDeleted:false};
    const stores={
      cases:[caseRow],files:[fileRow],
      clients:[{id:'client-context-1',fullName:'سلمى سعد',isDeleted:false},{id:'client-context-2',fullName:'موكل إضافي',isDeleted:false}],
      opponents:[{id:'opponent-context-1',name:'شركة الراية',isDeleted:false}],
      caseClients:[{id:'case-context-1::client-context-1',caseId:'case-context-1',clientId:'client-context-1'}],
      caseOpponents:[{id:'case-context-1::opponent-context-1',caseId:'case-context-1',opponentId:'opponent-context-1'}],
      fileParties:[{id:'party-client-duplicate',fileId:'file-context-1',partyKind:'client',clientId:'client-context-1',partyName:'اسم قديم مكرر'},{id:'party-client-extra',fileId:'file-context-1',partyKind:'client',partyName:'موكل من الملف'},{id:'party-opponent-duplicate',fileId:'file-context-1',partyKind:'opponent',opponentId:'opponent-context-1',partyName:'خصم قديم مكرر'}]
    };
    const repo=store=>({
      get:async id=>(stores[store]||[]).find(row=>row.id===id)||null,
      getMany:async ids=>(stores[store]||[]).filter(row=>ids.includes(row.id)&&!row.isDeleted),
      byIndex:async(index,key)=>(stores[store]||[]).filter(row=>JSON.stringify(row[index])===JSON.stringify(key)&&!row.isDeleted),
      byIndexAll:async(index,key)=>(stores[store]||[]).filter(row=>JSON.stringify(row[index])===JSON.stringify(key)&&!row.isDeleted),
      countByIndex:async()=>0,
      all:async()=>[]
    });
    const office={r:new Proxy({}, {get:(_target,store)=>repo(store)})};
    const html=await recordPage({office,ctx:{profile:{id:'record-context-test'}}},'cases',caseRow.id);
    expect(html.includes('<details class="record-actions-disclosure"')).toBe(true);
    expect(html.includes('أنت هنا: قضية / مرحلة')).toBe(true);
    expect(html.includes('data-open-ref="files:file-context-1"')).toBe(true);
    expect(html.includes('data-wc-linked-task')).toBe(true);
    expect(html.includes('data-rec-edit')).toBe(true);
    expect(html.includes('data-rec-delete')).toBe(true);
    expect(html.includes('data-list-nav-id')).toBe(false);
    expect(html.includes('→ السابق')).toBe(false);
    expect(html.includes('التالي ←')).toBe(false);
    expect(html.includes('رقم القضية والسنة')).toBe(true);
    expect(html.includes('موضوع الاختبار')).toBe(true);
    expect(html.includes('سلمى سعد')).toBe(true);
    expect(html.includes('موكل من الملف')).toBe(true);
    expect(html.includes('شركة الراية')).toBe(true);
    expect(html.includes('اسم قديم مكرر')).toBe(false);
    expect(html.includes('خصم قديم مكرر')).toBe(false);
    expect(html.includes('data-display-item="field:caseNumber"')).toBe(false);
    expect(html.includes('data-display-item="field:subject"')).toBe(false);
  });
}
