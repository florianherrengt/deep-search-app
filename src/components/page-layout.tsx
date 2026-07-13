import type { ComponentProps, ReactNode } from "react";
import { Box, Container, Group, ScrollArea, Stack, Text, Title, rem } from "@mantine/core";

interface PageLayoutProps {
  children: ReactNode;
  size?: ComponentProps<typeof Container>["size"];
}

interface PageHeaderProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function PageLayout({ children, size = "sm" }: PageLayoutProps) {
  return (
    <ScrollArea h="100%" type="auto" scrollbarSize={8}>
      <Container
        size={size}
        px={{ base: "md", sm: "xl" }}
        py={{ base: "lg", sm: rem(40) }}
      >
        {children}
      </Container>
    </ScrollArea>
  );
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="flex-start" gap="lg" wrap="wrap">
      <Stack gap={rem(6)} style={{ flex: "1 1 20rem" }}>
        <Title order={1} size="h3" lh={1.2}>
          {title}
        </Title>
        <Text size="sm" c="dimmed" maw="var(--app-copy-max-width)">
          {description}
        </Text>
      </Stack>
      {action ? <Box style={{ flexShrink: 0 }}>{action}</Box> : null}
    </Group>
  );
}
