export type Locale = 'uk' | 'en';

export interface LocaleTexts {
  newLead: string;
  name: string;
  phone: string;
  email: string;
  message: string;
  page: string;
  files: string;
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
  attachmentErrors: {
    notAccepted: string;
    tooMany: (maxFiles: number) => string;
    tooLarge: (maxMegabytes: number) => string;
    unsupportedType: string;
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
    files: 'Файли',
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
    attachmentErrors: {
      notAccepted: 'Ця форма не приймає файли',
      tooMany: (maxFiles) => (maxFiles === 1 ? 'Можна додати лише 1 файл' : `Можна додати до ${maxFiles} файлів`),
      tooLarge: (maxMegabytes) => `Кожен файл має бути до ${maxMegabytes} МБ`,
      unsupportedType: 'Підходять фото (JPG, PNG, WebP, HEIC) або PDF',
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
    files: 'Files',
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
    attachmentErrors: {
      notAccepted: 'This form does not accept files',
      tooMany: (maxFiles) => (maxFiles === 1 ? 'You can attach only 1 file' : `You can attach up to ${maxFiles} files`),
      tooLarge: (maxMegabytes) => `Each file must be ${maxMegabytes} MB or smaller`,
      unsupportedType: 'Please attach photos (JPG, PNG, WebP, HEIC) or PDF',
    },
    resultPage: {
      thanksTitle: 'Thank you!',
      thanksBody: 'We have received your request and will get back to you soon.',
      errorTitle: 'Request not sent',
      backToSite: '← Back to the website',
    },
  },
};
