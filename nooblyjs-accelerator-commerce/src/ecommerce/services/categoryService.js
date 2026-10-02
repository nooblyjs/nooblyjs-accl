/**
 * @fileoverview Category Management Service
 *
 * @author NooblyJS eCommerce Team
 * @version 1.0.0
 */

'use strict';

/**
 * Category Management Service
 * Handles product categorization and hierarchy
 */
class CategoryService {
  constructor(services) {
    this.dataServe = services.dataServe;
    this.cache = services.cache;
    this.logger = services.logger;
    this.notifying = services.notifying;
  }

  /**
   * Create a new category
   */
  async createCategory(categoryData, userId) {
    try {
      // Validate required fields
      if (!categoryData.name) {
        throw new Error('Category name is required');
      }

      // Check if category already exists
      const existingCategories = await this.dataServe.jsonFindByPath('categories', 'name', categoryData.name);
      if (existingCategories.length > 0) {
        throw new Error('Category with this name already exists');
      }

      // Generate slug
      const slug = this.generateSlug(categoryData.name);

      // Check slug uniqueness
      const existingSlugs = await this.dataServe.jsonFindByPath('categories', 'slug', slug);
      if (existingSlugs.length > 0) {
        throw new Error('Category slug already exists');
      }

      const category = {
        name: categoryData.name.trim(),
        description: categoryData.description || '',
        slug,
        parentCategoryId: categoryData.parentCategoryId || null,
        imageUrl: categoryData.imageUrl || null,
        sortOrder: categoryData.sortOrder || 0,
        status: 'active',
        seoTitle: categoryData.seoTitle || categoryData.name,
        seoDescription: categoryData.seoDescription || categoryData.description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: userId
      };

      const categoryUuid = await this.dataServe.add('categories', category);

      // Clear cache
      await this.clearCategoryCache();

      this.notifying.notify('category-events', {
        type: 'category_created',
        categoryId: categoryUuid,
        categoryName: category.name,
        userId
      });

      this.logger.info(`Category created: ${category.name} (${categoryUuid})`);

      return { id: categoryUuid, ...category };
    } catch (error) {
      this.logger.error('Error creating category:', error);
      throw error;
    }
  }

  /**
   * Update an existing category
   */
  async updateCategory(categoryId, updateData, userId) {
    try {
      const category = await this.dataServe.getByUuid('categories', categoryId);

      if (!category) {
        throw new Error('Category not found');
      }

      // Update fields
      const updatableFields = [
        'name', 'description', 'parentCategoryId', 'imageUrl',
        'sortOrder', 'status', 'seoTitle', 'seoDescription'
      ];

      updatableFields.forEach(field => {
        if (updateData[field] !== undefined) {
          category[field] = updateData[field];
        }
      });

      // Update slug if name changed
      if (updateData.name && updateData.name !== category.name) {
        category.slug = this.generateSlug(updateData.name);
      }

      category.updatedAt = new Date().toISOString();
      category.updatedBy = userId;

      await this.dataServe.remove('categories', categoryId);
      const newCategoryUuid = await this.dataServe.add('categories', category);

      // Clear cache
      await this.clearCategoryCache();

      this.notifying.notify('category-events', {
        type: 'category_updated',
        categoryId: newCategoryUuid,
        categoryName: category.name,
        userId
      });

      this.logger.info(`Category updated: ${category.name} (${newCategoryUuid})`);

      return { id: newCategoryUuid, ...category };
    } catch (error) {
      this.logger.error('Error updating category:', error);
      throw error;
    }
  }

  /**
   * Get all categories with hierarchy
   */
  async getAllCategories(includeInactive = false) {
    try {
      const cacheKey = `categories:all:${includeInactive}`;
      let categories = await this.cache.get(cacheKey);

      if (!categories) {
        if (includeInactive) {
          categories = await this.dataServe.jsonFind('categories', () => true);
        } else {
          categories = await this.dataServe.jsonFindByCriteria('categories', { status: 'active' });
        }

        // Sort by sortOrder, then by name
        categories.sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) {
            return a.sortOrder - b.sortOrder;
          }
          return a.name.localeCompare(b.name);
        });

        // Cache for 1 hour
        await this.cache.put(cacheKey, categories, 3600);
      }

      return categories;
    } catch (error) {
      this.logger.error('Error getting all categories:', error);
      throw error;
    }
  }

  /**
   * Get category hierarchy tree
   */
  async getCategoryTree(includeInactive = false) {
    try {
      const cacheKey = `categories:tree:${includeInactive}`;
      let tree = await this.cache.get(cacheKey);

      if (!tree) {
        const categories = await this.getAllCategories(includeInactive);
        tree = this.buildCategoryTree(categories);

        // Cache for 1 hour
        await this.cache.put(cacheKey, tree, 3600);
      }

      return tree;
    } catch (error) {
      this.logger.error('Error getting category tree:', error);
      throw error;
    }
  }

  /**
   * Get category by ID or slug
   */
  async getCategory(identifier, bySlug = false) {
    try {
      let category;

      if (bySlug) {
        const categories = await this.dataServe.jsonFindByPath('categories', 'slug', identifier);
        category = categories[0] || null;
      } else {
        category = await this.dataServe.getByUuid('categories', identifier);
      }

      if (!category) {
        throw new Error('Category not found');
      }

      // Get parent category if exists
      if (category.parentCategoryId) {
        try {
          category.parentCategory = await this.dataServe.getByUuid('categories', category.parentCategoryId);
        } catch (error) {
          // Parent might have been deleted
          category.parentCategory = null;
        }
      }

      // Get child categories
      const childCategories = await this.dataServe.jsonFindByPath('categories', 'parentCategoryId', category.id);
      category.childCategories = childCategories.filter(c => c.status === 'active');

      // Get product count for this category
      const products = await this.dataServe.jsonFind('products', p =>
        p.category === category.name && p.status === 'active'
      );
      category.productCount = products.length;

      return category;
    } catch (error) {
      this.logger.error('Error getting category:', error);
      throw error;
    }
  }

  /**
   * Get root categories (categories without parent)
   */
  async getRootCategories() {
    try {
      const cacheKey = 'categories:root';
      let rootCategories = await this.cache.get(cacheKey);

      if (!rootCategories) {
        rootCategories = await this.dataServe.jsonFind('categories', c =>
          c.status === 'active' && !c.parentCategoryId
        );

        // Sort by sortOrder, then by name
        rootCategories.sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) {
            return a.sortOrder - b.sortOrder;
          }
          return a.name.localeCompare(b.name);
        });

        // Cache for 1 hour
        await this.cache.put(cacheKey, rootCategories, 3600);
      }

      return rootCategories;
    } catch (error) {
      this.logger.error('Error getting root categories:', error);
      throw error;
    }
  }

  /**
   * Get categories with product counts
   */
  async getCategoriesWithProductCounts() {
    try {
      const cacheKey = 'categories:with-counts';
      let categoriesWithCounts = await this.cache.get(cacheKey);

      if (!categoriesWithCounts) {
        const categories = await this.getAllCategories();
        categoriesWithCounts = [];

        for (const category of categories) {
          const products = await this.dataServe.jsonFind('products', p =>
            p.category === category.name && p.status === 'active'
          );

          categoriesWithCounts.push({
            ...category,
            productCount: products.length
          });
        }

        // Cache for 30 minutes
        await this.cache.put(cacheKey, categoriesWithCounts, 1800);
      }

      return categoriesWithCounts;
    } catch (error) {
      this.logger.error('Error getting categories with product counts:', error);
      throw error;
    }
  }

  /**
   * Search categories
   */
  async searchCategories(query) {
    try {
      const searchTerm = query.toLowerCase();
      const categories = await this.getAllCategories();

      return categories.filter(category =>
        category.name.toLowerCase().includes(searchTerm) ||
        category.description.toLowerCase().includes(searchTerm)
      );
    } catch (error) {
      this.logger.error('Error searching categories:', error);
      throw error;
    }
  }

  /**
   * Delete category (soft delete)
   */
  async deleteCategory(categoryId, userId) {
    try {
      const category = await this.dataServe.getByUuid('categories', categoryId);

      if (!category) {
        throw new Error('Category not found');
      }

      // Check if category has child categories
      const childCategories = await this.dataServe.jsonFindByPath('categories', 'parentCategoryId', categoryId);
      if (childCategories.length > 0) {
        throw new Error('Cannot delete category with child categories');
      }

      // Check if category has products
      const products = await this.dataServe.jsonFind('products', p =>
        p.category === category.name && p.status === 'active'
      );
      if (products.length > 0) {
        throw new Error('Cannot delete category with active products');
      }

      // Soft delete
      category.status = 'deleted';
      category.deletedAt = new Date().toISOString();
      category.deletedBy = userId;
      category.updatedAt = new Date().toISOString();

      await this.dataServe.remove('categories', categoryId);
      await this.dataServe.add('categories', category);

      // Clear cache
      await this.clearCategoryCache();

      this.notifying.notify('category-events', {
        type: 'category_deleted',
        categoryId,
        categoryName: category.name,
        userId
      });

      this.logger.info(`Category deleted: ${category.name} (${categoryId})`);

      return { message: 'Category deleted successfully' };
    } catch (error) {
      this.logger.error('Error deleting category:', error);
      throw error;
    }
  }

  /**
   * Get category breadcrumb
   */
  async getCategoryBreadcrumb(categoryId) {
    try {
      const breadcrumb = [];
      let currentCategory = await this.dataServe.getByUuid('categories', categoryId);

      while (currentCategory) {
        breadcrumb.unshift({
          id: currentCategory.id,
          name: currentCategory.name,
          slug: currentCategory.slug
        });

        if (currentCategory.parentCategoryId) {
          try {
            currentCategory = await this.dataServe.getByUuid('categories', currentCategory.parentCategoryId);
          } catch (error) {
            break; // Parent not found
          }
        } else {
          break;
        }
      }

      return breadcrumb;
    } catch (error) {
      this.logger.error('Error getting category breadcrumb:', error);
      throw error;
    }
  }

  /**
   * Generate slug from category name
   */
  generateSlug(name) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  }

  /**
   * Build category tree from flat array
   */
  buildCategoryTree(categories) {
    const categoryMap = {};
    const tree = [];

    // Create a map of categories by ID
    categories.forEach(category => {
      categoryMap[category.id] = { ...category, children: [] };
    });

    // Build the tree
    categories.forEach(category => {
      if (category.parentCategoryId && categoryMap[category.parentCategoryId]) {
        categoryMap[category.parentCategoryId].children.push(categoryMap[category.id]);
      } else {
        tree.push(categoryMap[category.id]);
      }
    });

    return tree;
  }

  /**
   * Clear category cache
   */
  async clearCategoryCache() {
    try {
      const cacheKeys = [
        'categories:all:true',
        'categories:all:false',
        'categories:tree:true',
        'categories:tree:false',
        'categories:root',
        'categories:with-counts'
      ];

      for (const key of cacheKeys) {
        await this.cache.delete(key);
      }
    } catch (error) {
      this.logger.error('Error clearing category cache:', error);
    }
  }

  /**
   * Initialize default categories
   */
  async initializeDefaultCategories() {
    try {
      const existingCategories = await this.getAllCategories(true);
      if (existingCategories.length > 0) {
        this.logger.info('Categories already exist, skipping initialization');
        return;
      }

      const defaultCategories = [
        {
          name: 'Electronics',
          description: 'Electronic devices and gadgets',
          sortOrder: 1
        },
        {
          name: 'Clothing',
          description: 'Fashion and apparel',
          sortOrder: 2
        },
        {
          name: 'Home & Garden',
          description: 'Home improvement and garden supplies',
          sortOrder: 3
        },
        {
          name: 'Sports & Outdoors',
          description: 'Sports equipment and outdoor gear',
          sortOrder: 4
        },
        {
          name: 'Books',
          description: 'Books and educational materials',
          sortOrder: 5
        },
        {
          name: 'Health & Beauty',
          description: 'Health and beauty products',
          sortOrder: 6
        }
      ];

      for (const categoryData of defaultCategories) {
        await this.createCategory(categoryData, 'system');
      }

      this.logger.info('Default categories initialized successfully');
    } catch (error) {
      this.logger.error('Error initializing default categories:', error);
    }
  }
}

module.exports = CategoryService;