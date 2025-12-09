'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Input,
  Select,
  Modal,
  Form,
  Popconfirm,
  Typography,
  App,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Title } = Typography;

interface User {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  role: 'ADMIN' | 'USER';
  status: 'ACTIVE' | 'DISABLED';
  lastLoginAt: string | null;
  createdAt: string;
  collectionPoints: Array<{
    collectionPoint: {
      id: string;
      name: string;
      code: string;
    };
  }>;
}

interface FormValues {
  username: string;
  password?: string;
  email?: string;
  name?: string;
  role: 'ADMIN' | 'USER';
  status?: 'ACTIVE' | 'DISABLED';
}

export default function UsersPage() {
  const t = useTranslations();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form] = Form.useForm();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        search,
        status: statusFilter,
        role: roleFilter,
      });

      const response = await fetch(`/api/users?${params}`);
      const data = await response.json();

      if (response.ok) {
        setUsers(data.data);
        setTotal(data.total);
      } else {
        message.error(data.message || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, statusFilter, roleFilter, t]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSearch = () => {
    setPage(1);
    fetchUsers();
  };

  const handleReset = () => {
    setSearch('');
    setStatusFilter('');
    setRoleFilter('');
    setPage(1);
  };

  const handleAdd = () => {
    setEditingUser(null);
    form.resetFields();
    form.setFieldsValue({ role: 'USER', status: 'ACTIVE' });
    setModalVisible(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    form.setFieldsValue({
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
    });
    setModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      const data = await response.json();

      if (response.ok) {
        message.success(t('common.success'));
        fetchUsers();
      } else {
        message.error(data.message || t('common.error'));
      }
    } catch {
      message.error(t('common.error'));
    }
  };

  const handleModalOk = async () => {
    try {
      const values = await form.validateFields();
      const isEditing = !!editingUser;
      const url = isEditing ? `/api/users/${editingUser.id}` : '/api/users';
      const method = isEditing ? 'PUT' : 'POST';

      // 编辑时如果密码为空则不更新密码
      if (isEditing && !values.password) {
        delete values.password;
      }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const data = await response.json();

      if (response.ok) {
        message.success(t('common.success'));
        setModalVisible(false);
        fetchUsers();
      } else {
        message.error(data.message || t('common.error'));
      }
    } catch {
      // 表单验证失败
    }
  };

  const columns: ColumnsType<User> = [
    {
      title: t('users.username'),
      dataIndex: 'username',
      key: 'username',
      width: 120,
    },
    {
      title: t('users.name'),
      dataIndex: 'name',
      key: 'name',
      width: 100,
      render: (name) => name || '-',
    },
    {
      title: t('users.email'),
      dataIndex: 'email',
      key: 'email',
      width: 180,
      render: (email) => email || '-',
    },
    {
      title: t('users.role'),
      dataIndex: 'role',
      key: 'role',
      width: 120,
      render: (role) => (
        <Tag color={role === 'ADMIN' ? 'blue' : 'default'}>
          {role === 'ADMIN' ? t('users.roleAdmin') : t('users.roleUser')}
        </Tag>
      ),
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => (
        <Tag color={status === 'ACTIVE' ? 'success' : 'error'}>
          {status === 'ACTIVE' ? t('status.active') : t('status.disabled')}
        </Tag>
      ),
    },
    {
      title: t('users.lastLoginAt'),
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      width: 160,
      render: (date) => (date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '-'),
    },
    {
      title: t('common.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (date) => dayjs(date).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 120,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title={t('users.deleteConfirm', { name: record.username })}
            onConfirm={() => handleDelete(record.id)}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
            destroyOnHidden
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        {t('users.title')}
      </Title>

      <Card variant="borderless">
        <Space style={{ marginBottom: 16 }} wrap>
          <Input
            placeholder={t('common.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 200 }}
            prefix={<SearchOutlined />}
          />
          <Select
            placeholder={t('users.role')}
            value={roleFilter || undefined}
            onChange={setRoleFilter}
            style={{ width: 140 }}
            allowClear
            options={[
              { value: 'ADMIN', label: t('users.roleAdmin') },
              { value: 'USER', label: t('users.roleUser') },
            ]}
          />
          <Select
            placeholder={t('common.status')}
            value={statusFilter || undefined}
            onChange={setStatusFilter}
            style={{ width: 120 }}
            allowClear
            options={[
              { value: 'ACTIVE', label: t('status.active') },
              { value: 'DISABLED', label: t('status.disabled') },
            ]}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
            {t('common.search')}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={handleReset}>
            {t('common.reset')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            {t('users.addUser')}
          </Button>
        </Space>

        <Table
          columns={columns}
          dataSource={users}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1000 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (total) => t('common.total', { count: total }),
            onChange: (page, pageSize) => {
              setPage(page);
              setPageSize(pageSize);
            },
          }}
        />
      </Card>

      <Modal
        title={editingUser ? t('users.editUser') : t('users.addUser')}
        open={modalVisible}
        onOk={handleModalOk}
        onCancel={() => setModalVisible(false)}
        destroyOnHidden
        forceRender
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="username"
            label={t('users.username')}
            rules={[{ required: true, message: t('validation.required', { field: t('users.username') }) }]}
          >
            <Input disabled={!!editingUser} />
          </Form.Item>
          <Form.Item
            name="password"
            label={editingUser ? t('users.newPassword') : t('auth.password')}
            rules={editingUser ? [] : [{ required: true, message: t('validation.required', { field: t('auth.password') }) }]}
            extra={editingUser ? t('users.resetPassword') : undefined}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name="name" label={t('users.name')}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label={t('users.email')}>
            <Input type="email" />
          </Form.Item>
          <Form.Item
            name="role"
            label={t('users.role')}
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: 'ADMIN', label: t('users.roleAdmin') },
                { value: 'USER', label: t('users.roleUser') },
              ]}
            />
          </Form.Item>
          {editingUser && (
            <Form.Item name="status" label={t('common.status')}>
              <Select
                options={[
                  { value: 'ACTIVE', label: t('status.active') },
                  { value: 'DISABLED', label: t('status.disabled') },
                ]}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}

