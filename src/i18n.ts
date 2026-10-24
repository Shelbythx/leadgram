export type Locale = 'uk' | 'en';

export interface LocaleTexts {
  newLead: string;
  name: string;
  phone: string;
  email: string;
  message: string;
  page: string;
  received: string;
  errors: {
    contactRequired: string;
    invalidPhone: string;
    invalidEmail: string;
    tooLong: string;
    badRequest: string;
    forbiddenOrigin: string;
    payloadTooLarge: string;
    rateLimited: string;
    deliveryFailed: string;
  };
  resultPage: {
    thanksTitle: string;
    thanksBody: string;
    errorTitle: string;
    backToSite: string;
  };
}

export const TEXTS: Record<Locale, LocaleTexts> = {
  uk: {
    newLead: 'Нова заявка',
    name: "Ім'я",
    phone: 'Телефон',
    email: 'Email',
    message: 'Повідомлення',
    page: 'Сторінка',
    received: 'Отримано',
    errors: {
      contactRequired: 'Вкажіть телефон або email, щоб ми могли з вами зв’язатися',
      invalidPhone: 'Перевірте номер телефону',
      invalidEmail: 'Перевірте адресу email',
      tooLong: 'Занадто довгий текст',
      badRequest: 'Не вдалося прочитати дані форми',
      forbiddenOrigin: 'Цей сайт не може надсилати заявки на цю адресу',
      payloadTooLarge: 'Забагато даних у формі',
      rateLimited: 'Забагато заявок поспіль. Спробуйте ще раз за кілька хвилин.',
      deliveryFailed: 'Не вдалося надіслати заявку. Спробуйте ще раз або зателефонуйте нам.',
    },
    resultPage: {
      thanksTitle: 'Дякуємо!',
      thanksBody: 'Заявку отримано. Ми зв’яжемося з вами найближчим часом.',
      errorTitle: 'Заявку не надіслано',
      backToSite: '← Повернутися на сайт',
    },
  },
  en: {
    newLead: 'New lead',
    name: 'Name',
    phone: 'Phone',
    email: 'Email',
    message: 'Message',
    page: 'Page',
    received: 'Received',
    errors: {
      contactRequired: 'Leave a phone number or an email so we can get back to you',
      invalidPhone: 'Please check the phone number',
      invalidEmail: 'Please check the email address',
      tooLong: 'This text is too long',
      badRequest: 'Could not read the form data',
      forbiddenOrigin: 'This website is not allowed to send leads here',
      payloadTooLarge: 'The form contains too much data',
      rateLimited: 'Too many requests in a row. Please try again in a few minutes.',
      deliveryFailed: 'We could not send your request. Please try again or give us a call.',
    },
    resultPage: {
      thanksTitle: 'Thank you!',
      thanksBody: 'We have received your request and will get back to you soon.',
      errorTitle: 'Request not sent',
      backToSite: '← Back to the website',
    },
  },
};
