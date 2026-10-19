# Omar's follow-up templates — submit these to Meta

WhatsApp only allows **approved templates** once a lead has been quiet for 24 hours,
so Omar can only follow up with these. Submit each in **English and Arabic**
(WhatsApp Manager → Message templates → Create). Category: **Marketing**.

Omar picks templates with **at most one variable**, which is the customer's first name, `{{1}}`.
Keep it to that, or he will skip the template.

The schedule is **day 1, 3, 7 and 14** after the lead goes quiet, then nurture on days 30, 60 and 90.
A reply stops it and hands the chat back to Aisha.

| Name (suggested) | When | Body (English) | Buttons |
|---|---|---|---|
| `pb_followup_day1` | Day 1 | Hi {{1}}, are you still looking for storage? We have units free at Al Quoz this week. Shall I hold one for you? | Quick reply: "Yes, hold one" / "Not now" |
| `pb_followup_day3_visit` | Day 3 | Hi {{1}}, here's a quick look inside our Al Quoz facility. Clean, secure and open 7 days. Would you like to come and see it? | Header: image or video · Quick reply: "Book a visit" |
| `pb_followup_day7_offer` | Day 7 | Hi {{1}}, a small offer to help you decide: 20% off your first 4 weeks if you pay upfront this week. Want me to send the price? | Quick reply: "Send the price" / "No thanks" |
| `pb_followup_day14_close` | Day 14 | Hi {{1}}, shall I close your storage request, or check back with you next month? | Quick reply: "Close it" / "Next month" |
| `pb_nurture_units` | Days 30, 60, 90 | Hi {{1}}, new units have just freed up at PurpleBox Al Quoz. If you still need storage, reply here and we'll find you the right size. | Quick reply: "I'm interested" |

## Arabic

| Name | Body (Arabic) |
|---|---|
| `pb_followup_day1` (ar) | مرحباً {{1}}، هل ما زلت تبحث عن مساحة تخزين؟ لدينا وحدات متاحة في القوز هذا الأسبوع. هل تريد أن نحجز لك واحدة؟ |
| `pb_followup_day3_visit` (ar) | مرحباً {{1}}، إليك نظرة سريعة على منشأتنا في القوز: نظيفة وآمنة ومفتوحة ٧ أيام. هل تود زيارتها؟ |
| `pb_followup_day7_offer` (ar) | مرحباً {{1}}، عرض خاص: خصم ٢٠٪ على أول ٤ أسابيع عند الدفع مقدماً هذا الأسبوع. هل نرسل لك السعر؟ |
| `pb_followup_day14_close` (ar) | مرحباً {{1}}، هل نغلق طلب التخزين الخاص بك، أم نتواصل معك الشهر القادم؟ |
| `pb_nurture_units` (ar) | مرحباً {{1}}، توفرت وحدات جديدة في بيوربل بوكس القوز. إذا كنت ما زلت بحاجة إلى تخزين، رد هنا وسنجد لك الحجم المناسب. |

Check the 20% offer is one you actually run before submitting `pb_followup_day7_offer`.
