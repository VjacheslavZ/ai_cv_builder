'use client';

import { useFieldArray } from 'react-hook-form';

import { EditableField } from './editable-field';
import { useEditor } from './editor-context';
import { LinkField } from './link-field';
import { FieldAnchor, SectionFrame } from './section-frame';

/** Name and contact details (AC-10.1), with mobile keyboards and autofill hints (NFR-M3). */
export function ContactEditor() {
  const { form } = useEditor();
  const links = useFieldArray({ control: form.control, name: 'contact.links', keyName: 'key' });

  return (
    <SectionFrame path="contact" title="Contact">
      <FieldAnchor path="contact.name">
        <EditableField
          name="contact.name"
          path="contact.name"
          label="Full name"
          autoComplete="name"
        />
      </FieldAnchor>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldAnchor path="contact.email">
          <EditableField
            name="contact.email"
            path="contact.email"
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
          />
        </FieldAnchor>
        <FieldAnchor path="contact.phone">
          <EditableField
            name="contact.phone"
            path="contact.phone"
            label="Phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
          />
        </FieldAnchor>
        <FieldAnchor path="contact.city">
          <EditableField
            name="contact.city"
            path="contact.city"
            label="City"
            autoComplete="address-level2"
          />
        </FieldAnchor>
      </div>
      {links.fields.map((link, index) => (
        <LinkField key={link.key} index={index} id={link.id} />
      ))}
    </SectionFrame>
  );
}
