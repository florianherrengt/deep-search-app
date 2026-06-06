---
name: mantine-form
description: >
  Build forms with Mantine's useForm hook. Use this skill when: (1) creating forms with
  validation, (2) managing form state with useForm, (3) handling nested/array fields,
  (4) implementing custom validators, (5) integrating forms with Mantine inputs via
  getInputProps, (6) using form contexts (createFormContext), or (7) any task involving
  @mantine/form, useForm, useField, or form validation.
---

# Mantine Form Skill

## Overview

`@mantine/form` provides a `useForm` hook for managing form state, validation, and input bindings
in React applications. It works seamlessly with all Mantine input components.

## Core Workflow

### 1. Initialize form

```tsx
import { useForm } from '@mantine/form';

const form = useForm({
  initialValues: {
    name: '',
    email: '',
    age: 0,
  },
  validate: {
    name: (value) => value.length < 2 ? 'Name must have at least 2 letters' : null,
    email: (value) => /^\S+@\S+$/.test(value) ? null : 'Invalid email',
    age: (value) => value < 18 ? 'You must be at least 18' : null,
  },
});
```

### 2. Bind to inputs

```tsx
<form onSubmit={form.onSubmit((values) => console.log(values))}>
  <TextInput label="Name" {...form.getInputProps('name')} />
  <TextInput label="Email" {...form.getInputProps('email')} />
  <NumberInput label="Age" {...form.getInputProps('age')} />
  <Button type="submit">Submit</Button>
</form>
```

### 3. Handle submission

```tsx
form.onSubmit((values) => {
  // values is typed as { name: string; email: string; age: number }
  fetch('/api/submit', { method: 'POST', body: JSON.stringify(values) });
});
```

## Key Concepts

| Concept | Description |
|---|---|
| `getInputProps(path)` | Returns `{ value, onChange, error, onFocus, onBlur }` to spread on inputs |
| `validate` | Object of validation functions or a single function returning errors |
| `onSubmit(handler)` | Returns form event handler; only calls handler when valid |
| `transformValues` | Transform values before they reach onSubmit handler |
| `mode: 'uncontrolled'` | Use refs instead of state — no re-renders on input change |

## References

- **[`references/api.md`](references/api.md)** — Full API: useForm options, return value, useField, createFormContext, built-in validators, key types
- **[`references/patterns.md`](references/patterns.md)** — Code examples: nested objects, arrays, async validation, form context, uncontrolled mode
